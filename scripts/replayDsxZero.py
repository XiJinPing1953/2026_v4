"""Replay validated Modbus scale samples through the MCU and handheld zero engines."""
import argparse, json, re, subprocess, tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'native/dsx-session-zero'
H = """#include <stdio.h>
#include "dsx_zero.h"
int main(void){dsx_zero_t s;dsx_zero_reset(&s);unsigned ms;int mg;
while(scanf("%u %d",&ms,&mg)==2){int ready=dsx_zero_observe(&s,mg,ms,1);
printf("%d %d\\n",ready,s.offset_mg);}return 0;}"""
JS = """const fs=require('node:fs'),vm=require('node:vm');
const z=vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8').replace(/export /g,'')+';createFloorScaleZero()');
const out=[];for(const ln of fs.readFileSync(0,'utf8').trim().split(/\\n/)){
 const [ms,mg]=ln.split(' ').map(Number);z.observe(mg/1e6,ms);
 out.push((z.ready?1:0)+' '+Math.round(z.offset*1e6));}console.log(out.join('\\n'));"""
def crc(buf):
    n=65535
    for b in buf:
        n ^= b
        for _ in range(8): n=(n>>1)^0xa001 if n&1 else n>>1
    return n
def samples(path):
    rows=[]; cfg={}; epoch=None
    for ln in path.read_text(encoding='utf-8-sig').splitlines():
        m=re.fullmatch(r'([\d:.]+) TX ([\dA-F-]+) RX ([\dA-F-]+)',ln)
        if not m: continue
        a,b=(bytes.fromhex(s.replace('-','')) for s in m.groups()[1:])
        count=int.from_bytes(a[4:6],'big'); addr=int.from_bytes(a[2:4],'big')
        assert (len(a),a[:2],b[:3],len(b),crc(a),crc(b))==(8,b'\x01\x03',bytes([1,3,2*count]),5+2*count,0,0)
        vals=[int.from_bytes(b[i:i+2],'big') for i in range(3,len(b)-2,2)]
        if addr==0:
            t=datetime.strptime(m[1],'%H:%M:%S.%f')
            if epoch is None: epoch=t
            v=vals[0]|(vals[1]<<16)
            rows.append((10000+round((t-epoch).total_seconds()*1000),v-2**32 if v>=2**31 else v))
        else: cfg.update(enumerate(vals,start=addr))
    assert rows and (cfg[19],cfg[21])==(0,1), 'Expected grams with one decimal'
    return [(t,v*100) for t,v in rows]
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory',type=Path);args=parser.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        d=Path(tmp); (d/'h.c').write_text(H)
        exe=d/'test'; subprocess.run(['clang','-std=c99','-Wall','-Wextra','-Werror','-I',str(NATIVE),str(d/'h.c'),str(NATIVE/'dsx_zero.c'),'-o',str(exe)],check=True)
        def replay(rows):
            wire=''.join(f'{t} {v}\n' for t,v in rows)
            c=subprocess.check_output([str(exe)],input=wire,text=True)
            js=subprocess.check_output(['node','-e',JS,str(ROOT/'src/services/pda/floorScaleZero.js')],input=wire,text=True)
            assert c==js,'MCU/handheld state diverged'
            return [tuple(map(int,s.split())) for s in c.splitlines()]
        logs=sorted(args.directory.glob('DSX-repower-*.txt'))+sorted(args.directory.glob('DSX-platform-cycle20kg-*.txt'))
        assert len(logs)>=4
        for log in logs:
            rows=samples(log); states=replay(rows)
            result=dict(file=log.name,samples=len(rows))
            if 'repower' in log.name:
                starts=[i for i in range(1,len(rows)) if rows[i][0]-rows[i-1][0]>3000]
                assert len(starts)==1
                a=starts[0];ready=next(i for i in range(a,len(rows)) if states[i][0])
                assert rows[a][1]==-77480900 and states[a][0]==0
                assert all(not r for (t,v),(r,o) in zip(rows[a:],states[a:]) if v==-77480900)
                result.update(ready_ms=rows[ready][0]-rows[a][0],first_working_kg=(rows[ready][1]-states[ready][1])/1e6,last_working_kg=(rows[-1][1]-states[-1][1])/1e6)
            print(json.dumps(result,ensure_ascii=False))
        def series(vals):
            return [(10000+i*100,v) for i,v in enumerate(vals)]
        for mg in (250000,-250000,3700000,-3700000,20000000,185000000):
            res=replay(series([mg]*80));assert res[0]==(0,0) and res[-1]==(1,0)
        vals=[150000]*40+[v+150000 for v in range(185000000,164999999,-5000)]
        res=replay(series(vals));assert all(x==(1,150000) for x in res[39:])
        assert vals[-1]-res[-1][1]==165000000
        print('Synthetic: +/-0.25 and +/-3.7 kg preserved; loaded startup 20/185 kg preserved; 185 to 165 kg in 4000 successive 5 g decreases, offset unchanged.')
if __name__=='__main__':main()

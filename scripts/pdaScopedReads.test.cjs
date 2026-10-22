const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm')
for(const [file,fn,args] of [['saleRecords.js','listPdaSales',[{date:'2026-10-23'}]],['saleRecords.js','getPdaSale',['sale1']],['fillingLabel.js','issueFillingLabel',[{filling_id:'f1'}]],['fillingLabel.js','resolveFillingLabel',[{token:'label'}]]]) {
 test(`${fn} cancels stale auth handling after account switch or leave`,async()=>{
  let user={_id:'a'},token='a-token',active=true,finish,authEffects=0
  const s={getUser:()=>user,getToken:()=>token,callCloud:(_name,options)=>new Promise(resolve=>{finish=()=>{if(options.isResponseCurrent())authEffects++;resolve({code:401})}})}
  vm.runInNewContext(fs.readFileSync('src/services/pda/'+file,'utf8').replace(/^import.*\n/gm,'').replace(/^export /gm,'')+`;this.run=${fn}`,s)
  let p=s.run(...args,{shouldContinue:()=>active});user={_id:'b'};token='b-token';finish();await p;assert.equal(authEffects,0)
  p=s.run(...args,{shouldContinue:()=>active});active=false;finish();await p;assert.equal(authEffects,0)
  active=true;p=s.run(...args,{shouldContinue:()=>active});finish();await p;assert.equal(authEffects,1)
 })
}

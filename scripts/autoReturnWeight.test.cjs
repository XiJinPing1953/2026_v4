const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const {createAutoReweighWeight}=vm.runInNewContext(fs.readFileSync('src/services/pda/autoReturnWeight.js','utf8').replace(/export /g,'')+'\n;({createAutoReweighWeight})',{Date})
function rig(){const a=createAutoReweighWeight();let t=10000;return {a,run(w,ms=3100){let result=null;for(let i=0;i<=ms;i+=100){t+=100;const x=a.feed({sampled_at:t,display_kg:w},124,t);if(x!==null)result=x}return result},gap(){t+=1000}}}
test('跳过长时间空钩，3秒稳定允许负净重，短平台不取重',()=>{const h=rig();assert.equal(h.run(1,5000),null);assert.equal(h.run(125,2000),null);assert.equal(h.run(122),122)})
test('小幅稳定修正、固定锚点阻止阶梯下降，恢复允许更新',()=>{const h=rig();assert.equal(h.run(148),148);assert.equal(h.run(147.5),147.5);assert.equal(h.run(144),144);assert.equal(h.run(141),141);assert.equal(h.run(138),null);assert.equal(h.run(100),null);assert.equal(h.run(0),null);assert.equal(h.run(147.5),147.5)})
test('间断/过期帧不能拼成稳定；下一瓶重置锚点',()=>{const h=rig();assert.equal(h.run(122,1500),null);h.gap();assert.equal(h.run(122,1400),null);assert.equal(h.run(122,1700),122);h.a.reset();assert.equal(h.run(90),90);assert.equal(h.a.feed({sampled_at:1,display_kg:130},124,10000),null)})
test('更高稳定重量抬升锚点，卸瓶中途平台不能覆盖',()=>{const h=rig();assert.equal(h.run(125),125);assert.equal(h.run(148),148);assert.equal(h.run(125),null);assert.equal(h.run(147.5),147.5)})
test('一通知多帧同时间戳保留稳定窗口；不同重量仍重计时',()=>{const a=createAutoReweighWeight();let last=null;for(let t=10000;t<=16000;t+=100){for(let n=0;n<2;n++){const x=a.feed({sampled_at:t,display_kg:122},124,t);if(x!==null)last=x}}assert.equal(last,122);assert.equal(a.feed({sampled_at:16000,display_kg:123},124,16000),null)})
test('无效、未来和过期读数中断连续稳定窗口',()=>{const a=createAutoReweighWeight();for(let t=10000;t<=12000;t+=100)a.feed({sampled_at:t,display_kg:122},124,t);assert.equal(a.feed({sampled_at:12001,display_kg:122},124,12000),null);assert.equal(a.feed({sampled_at:8000,display_kg:122},124,12000),null);assert.equal(a.feed({sampled_at:12000,display_kg:NaN},124,12000),null);assert.equal(a.feed({sampled_at:13000,display_kg:122},124,13000),null)})
test('2秒与默认3秒边界分别生效，不缩短原生销售默认窗口',()=>{
 const fast=createAutoReweighWeight({stableWindowMs:2000}),original=createAutoReweighWeight()
 const feed=(a,t,w=122)=>a.feed({sampled_at:t,display_kg:w},124,t)
 for(let t=10000;t<12000;t+=100){assert.equal(feed(fast,t),null);assert.equal(feed(original,t),null)}
 assert.equal(feed(fast,12000),122);assert.equal(feed(original,12000),null)
 for(let t=12100;t<13000;t+=100)assert.equal(feed(original,t),null)
 assert.equal(feed(original,13000),122)
})
test('复秤配置2秒时，重量变化和断流必须重新连续计时',()=>{
 const a=createAutoReweighWeight({stableWindowMs:2000});let t=10000
 const frame=(w,dt=100)=>{t+=dt;return a.feed({sampled_at:t,display_kg:w},124,t)}
 for(let i=0;i<20;i++)assert.equal(frame(122),null)
 assert.equal(frame(123),null);for(let i=0;i<19;i++)assert.equal(frame(123),null)
 assert.equal(frame(123,400),null);for(let i=0;i<19;i++)assert.equal(frame(123),null)
 assert.equal(frame(123),123)
})
test('可行性反例：2.5秒中途平台会被2秒接受，但3秒不接受',()=>{
 const fast=createAutoReweighWeight({stableWindowMs:2000}),original=createAutoReweighWeight()
 const run=(a,w,from,to)=>{const accepted=[];for(let t=from;t<=to;t+=100){const v=a.feed({sampled_at:t,display_kg:w},124,t);if(v!==null)accepted.push([t,v])}return accepted}
 assert.deepEqual(run(fast,125,10000,12500),[[12000,125]])
 assert.deepEqual(run(original,125,10000,12500),[])
 assert.deepEqual(run(fast,148,12600,15600),[[14600,148]])
 assert.deepEqual(run(original,148,12600,15600),[[15600,148]])
 assert.deepEqual(run(fast,125,15700,18700),[],'已接受最终悬重后，卸瓶平台仍被锚点阻止')
})

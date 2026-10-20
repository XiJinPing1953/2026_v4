const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const source=fs.readFileSync('src/services/pda/appUpdate.js','utf8').replace(/export /g,'')
const load=extra=>vm.runInNewContext(source+';({compareAppVersion,validatePdaUpdate,checkPdaAppUpdate})',{Date,...extra})
const meta={schema:1,appid:'__UNI__756A841',platform:'android',version:'1.0.14',minNativeVersion:'1.0.13',maxNativeVersion:'1.0.13',file:'crm-pda-1.0.14-123456abcdef.wgt',sha1:'a'.repeat(40),size:42}
test('版本比较兼容多位数字，拒绝降级或不兼容原生壳',()=>{const a=load();assert.equal(a.compareAppVersion('1.0.14','1.0.9'),1);assert.equal(a.validatePdaUpdate(meta,'1.0.14','1.0.13'),null);assert.throws(()=>a.validatePdaUpdate(meta,'1.0.12','1.0.12'),/APK/);assert.throws(()=>a.validatePdaUpdate(meta,'1.0.12','1.0.15'),/APK/)})
test('拒绝其他appid、跨域路径和缺失摘要',()=>{const a=load();for(const patch of [{appid:'evil'},{file:'https://evil/a.wgt'},{file:'../a.wgt'},{sha1:''},{size:0}])assert.throws(()=>a.validatePdaUpdate({...meta,...patch},'1.0.13','1.0.13'))})
function harness(opts={}){let installed=0,restarted=0,deleted=0,route='pages/pda/home';const messages=[]
 const plus={android:{},runtime:{appid:meta.appid,version:'1.0.13',getProperty:(id,fn)=>fn({version:'1.0.13'}),install:(p,o,ok,fail)=>{installed++;assert.equal(o.force,false);opts.installFail?fail({message:'install failed'}):ok()},restart:()=>restarted++},io:{getFileInfo:o=>o.success({size:42,digest:opts.badHash?'b'.repeat(40):meta.sha1}),resolveLocalFileSystemURL:(p,ok)=>ok({remove:ok=>{deleted++;ok()}})}}
 const uni={request:o=>o.success({statusCode:200,data:meta}),showModal:o=>{messages.push(o.title);o.success({confirm:!opts.cancel})},showToast(){},showLoading(){},hideLoading(){},downloadFile:o=>{if(opts.leave)route='pages/pda/reweigh';o.success({statusCode:200,tempFilePath:'_doc/test.wgt'})}}
 return {run:load({plus,uni,getCurrentPages:()=>[{route}]}).checkPdaAppUpdate,state:()=>({installed,restarted,deleted,messages})}
}
test('完整校验后安装再重启并清理临时包',async()=>{const h=harness();await h.run();assert.equal(h.state().installed,1);assert.equal(h.state().restarted,1);assert.equal(h.state().deleted,1)})
for(const mode of ['badHash','cancel','leave','installFail'])test(`${mode} 不重启且不删除业务存储`,async()=>{const h=harness({[mode]:true});await h.run();assert.equal(h.state().restarted,0);assert.equal(h.state().installed,mode==='installFail'?1:0)})

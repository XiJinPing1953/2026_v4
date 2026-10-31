const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const {readPdaStorage}=vm.runInNewContext(fs.readFileSync('src/services/pda/asyncStorage.js','utf8').replace(/^export /gm,'')+';({readPdaStorage})',{setTimeout,clearTimeout})
test('only confirmed absence is an empty draft; failed existing reads remain failures',async()=>{
 assert.equal(await readPdaStorage({getStorage:o=>o.success({data:'saved'})},'key'),'saved')
 const runtime={getStorage:o=>o.fail({errMsg:'read failed'}),getStorageInfo:o=>o.success({keys:[]})}
 assert.equal(await readPdaStorage(runtime,'key'),null)
 runtime.getStorageInfo=o=>o.success({keys:['key']});await assert.rejects(readPdaStorage(runtime,'key'),/read failed/)
 runtime.getStorageInfo=o=>o.fail();await assert.rejects(readPdaStorage(runtime,'key'),/无法核对/)
})

test('native callbacks that never finish time out, and late callbacks cannot complete again',async()=>{
 let expire,callbacks
 const api=vm.runInNewContext(fs.readFileSync('src/services/pda/asyncStorage.js','utf8').replace(/^export /gm,'')+';({readPdaStorage})',{setTimeout:fn=>{expire=fn;return 1},clearTimeout:()=>{}})
 const pending=api.readPdaStorage({getStorage:o=>{callbacks=o}},'key');expire();await assert.rejects(pending,/超时/);callbacks.success({data:'late'})
})

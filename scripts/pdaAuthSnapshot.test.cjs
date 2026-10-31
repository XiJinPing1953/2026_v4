const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value))
function harness(native = true) {
 const map = new Map([['crm_token', 'session-1'], ['crm_user', { _id: 'u1', permissions: { save: true } }]])
 const stats = { reads: 0, checks: 0 }, pending = []
 let failWrite = false
 let source = fs.readFileSync('src/services/auth.js', 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '')
 if (!native) source = source.replace(/\/\/ #ifdef APP-PLUS[\s\S]*?\/\/ #endif/g, '')
 const api = vm.runInNewContext(source + '\n;({getToken,getUser,setToken,setUser,clearAuth,syncCurrentUser})', {
  uni: { getStorageSync(k) { stats.reads++; return clone(map.get(k)) }, setStorageSync(k,v) { if(failWrite)throw Error('storage failed');map.set(k,clone(v)) }, removeStorageSync:k=>map.delete(k) },
  uniCloud: { callFunction() { stats.checks++; return new Promise(resolve=>pending.push(resolve)) } }
 })
 return { api, map, stats, pending, failWrite: value=>{failWrite=value} }
}
test('native repeated owner/permission checks use two storage reads, with immutable snapshots', () => {
 const h=harness()
 for(let i=0;i<1000;i++){assert.equal(h.api.getToken(),'session-1');assert.equal(h.api.getUser()._id,'u1')}
 assert.equal(h.stats.reads,2)
 assert.equal(Object.isFrozen(h.api.getUser().permissions),true)
 const next={_id:'u2',permissions:{save:false}};h.api.setToken('session-2');h.api.setUser(next);next._id='mutated'
 assert.equal(h.api.getUser()._id,'u2');assert.equal(h.api.getToken(),'session-2')
 h.api.clearAuth();assert.equal(h.api.getToken(),'');assert.equal(h.api.getUser(),null)
})
test('H5 continues reading other tabs auth writes',()=>{
 const h=harness(false);assert.equal(h.api.getUser()._id,'u1')
 h.map.set('crm_user',{_id:'u2'});h.map.set('crm_token','session-2')
 assert.equal(h.api.getUser()._id,'u2');assert.equal(h.api.getToken(),'session-2')
 h.map.clear();assert.equal(h.api.getUser(),null);assert.equal(h.api.getToken(),'')
})
test('failed writes do not replace the native snapshot',()=>{
 const h=harness();h.api.getUser();h.api.getToken();h.failWrite(true)
 assert.throws(()=>h.api.setUser({_id:'u2'}),/storage failed/)
 assert.throws(()=>h.api.setToken('session-2'),/storage failed/)
 assert.equal(h.api.getUser()._id,'u1');assert.equal(h.api.getToken(),'session-1')
})
test('concurrent forced checks share one request; completed checks refresh permissions',async()=>{
 const h=harness(),a=h.api.syncCurrentUser({force:true}),b=h.api.syncCurrentUser({force:true})
 assert.equal(h.stats.checks,1);h.pending[0]({result:{code:0,user:{_id:'u1',permissions:{save:false}}}})
 await Promise.all([a,b]);assert.equal(h.api.getUser().permissions.save,false)
 await h.api.syncCurrentUser();assert.equal(h.stats.checks,1)
})
for(const code of [0,401])test(`late ${code} response cannot overwrite/logout a new account or clear its pending request`,async()=>{
 const h=harness(),old=h.api.syncCurrentUser({force:true})
 h.api.setToken('session-2');h.api.setUser({_id:'u2'})
 const next=h.api.syncCurrentUser({force:true})
 h.pending[0]({result:{code,user:{_id:'u1'}}});assert.equal((await old).stale,true)
 const same=h.api.syncCurrentUser({force:true});assert.equal(h.stats.checks,2)
 assert.equal(h.api.getUser()._id,'u2');assert.equal(h.api.getToken(),'session-2')
 h.pending[1]({result:{code:0,user:{_id:'u2',role:'new'}}});await Promise.all([next,same]);assert.equal(h.api.getUser().role,'new')
})
test('logout/relogin with same token still invalidates the previous response',async()=>{
 const h=harness(),old=h.api.syncCurrentUser();h.api.clearAuth();h.api.setToken('session-1');h.api.setUser({_id:'u1',role:'new'})
 h.pending[0]({result:{code:401}});assert.equal((await old).stale,true);assert.equal(h.api.getUser().role,'new')
})

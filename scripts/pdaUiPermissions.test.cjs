const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm')
const load=p=>fs.readFileSync(p,'utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,'')
function rig() {
 const registry=vm.runInNewContext(load('src/services/pageAclRegistry.js')+';({PAGE_REGISTRY,PAGE_REGISTRY_MAP,buildRoleTemplatePermissions,normalizeRoleTemplate})')
 let builds=0
 const api=vm.runInNewContext(load('src/services/pageAcl.js')+';({canPageAction,getResolvedPagePermissions})',{...registry,getUser:()=>null,buildRoleTemplatePermissions:r=>{builds++; return registry.buildRoleTemplatePermissions(r)}})
 return {api,registry,builds:()=>builds}
}
test('individual button checks match the full ACL across registered actions, overrides and live account changes',()=>{
 const {api,registry}=rig()
 for(const role of ['pda_operator','safety_inspector','superadmin','user','admin','finance','invalid']) {
  const user={role,page_permissions:{}}
  for(const override of [undefined,false,true]){
   for(const item of registry.PAGE_REGISTRY) user.page_permissions[item.pagePath]={view:override,create:override,update:override,delete:override}
   const full=api.getResolvedPagePermissions(user)
   for(const item of registry.PAGE_REGISTRY) for(const bit of ['view','create','update','delete'])
    assert.equal(api.canPageAction(item.pagePath,bit,user),full[item.pagePath][bit],role+':'+item.pagePath+':'+bit)
  }
 }
 assert.equal(api.canPageAction('/not/a/page','view',{role:'superadmin'}),false)
})
test('a sequence of PDA page checks builds at most one default matrix per role',()=>{
 const {api,builds}=rig(), u={role:'pda_operator'}
 for(let round=0;round<4;round++)for(const p of ['home','reweigh','floor-calibration','sale-create'])for(const bit of ['view','update'])api.canPageAction('/pages/pda/'+p,bit,u)
 assert.equal(builds(),1)
})

'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {makeDb}=require('./lib/accountingTestHarness.cjs')
const {service,FLEET,NAMES}=require('../uniCloud-alipay/cloudfunctions/crm-user/fleetDispatch')
const acl=require('../uniCloud-alipay/cloudfunctions/crm-user/pageAclLocal')
function fixture(hooks={}) {
  const admin={_id:'admin',username:'boss',role:'superadmin',token:'boss'}
  const editor={_id:'editor',role:'user',token:'editor',page_permissions:{'/pages/vehicle/dispatch':{view:true,update:true}}}
  const tables={crm_users:[admin,editor],crm_vehicles:FLEET.map(([plate_no],i)=>({_id:'v'+i,plate_no,is_active:true})),crm_delivery_men:NAMES.map((name,i)=>({_id:'p'+i,name,is_active:true})),crm_operation_logs:[]}
  const db=makeDb(tables,{transaction:true,mutate:true,txDocumentObject:true,...hooks})
  const run=service(db,acl,({username,nickname,passwordHash,roleTemplate})=>({username,nickname,password_hash:passwordHash,role:roleTemplate,role_template:roleTemplate}),async()=>'fake-testing-hash')
  const board=async()=>{const r=await run(admin,'fleetBoardV1');assert.equal(r.code,0);return r.data}
  const packet=(b,id)=>({batchId:'test-batch-'+id,revision:b.revision,versions:Object.fromEntries(b.rows.map(r=>[r.plate,r.version])),assignments:Object.fromEntries(b.rows.map(r=>[r.plate,r.suggested])),password:'test-only'})
  return {admin,editor,tables,db,run,board,packet}
}
test('known vehicles match their existing dedicated account; create missing accounts without changing the crew',async()=>{
  const h=fixture(),b=await h.board(),p=h.packet(b,'100')
  assert.equal(b.rows.length,5);assert.equal(b.staff.length,9)
  assert.equal((await h.run(h.editor,'fleetProvisionV1',p)).code,403)
  assert.equal((await h.run(h.admin,'fleetProvisionV1',p)).code,0)
  assert.equal((await h.run(h.admin,'fleetProvisionV1',p)).code,0)
  assert.equal(h.tables.crm_users.length,7)
  assert.equal(JSON.stringify(h.tables).includes(p.password),false)
  const ready=await h.board()
  assert.ok(ready.rows.every(r=>r.status==='ready' && !r.assigned[0]))
  const user=h.tables.crm_users.find(u=>u.username==='38u7g')
  Object.assign(user,{username:'dedicated-truck-name',nickname:'车三'})
  Object.assign(user.mobile_sale_defaults,{delivery1_id:'p3',delivery1:NAMES[3],delivery2_id:'p2',delivery2:NAMES[2]})
  assert.equal((await h.board()).rows[3].username,'dedicated-truck-name')
  const plan=h.packet(await h.board(),'101')
  const old=structuredClone(user)
  assert.equal((await h.run(h.admin,'fleetProvisionV1',plan)).code,0)
  assert.deepEqual(h.tables.crm_users.find(u=>u._id===old._id),old)
  assert.equal((await h.run(user,'fleetBoardV1')).code,403)
})
test('swap drivers and move a partner in one revision, reject stale edits, duplicate crew, missing drivers and altered retry',async()=>{
  const h=fixture()
  await h.run(h.admin,'fleetProvisionV1',h.packet(await h.board(),'120'))
  const b=await h.board(), p=h.packet(b,'121')
  const [a,c]=FLEET.map(([plate])=>plate)
  p.assignments[a]=['p1','p8'];p.assignments[c]=['p0','']
  const good=await h.run(h.editor,'fleetSaveV1',p);assert.equal(good.code,0)
  assert.equal((await h.run(h.editor,'fleetResultV1',p)).data.revision,good.data.revision)
  assert.equal((await h.run(h.editor,'fleetSaveV1',p)).code,0)
  const stale=await h.run(h.editor,'fleetSaveV1',{...p,batchId:'another-batch-uuid'})
  assert.equal(stale.code,409);assert.ok(stale.data.changed.includes(a))
  const changed=h.packet(await h.board(),'122');changed.assignments[a][1]='';changed.assignments[c][1]='p8'
  assert.equal((await h.run(h.editor,'fleetSaveV1',changed)).code,0)
  changed.assignments[c][1]='p7';assert.equal((await h.run(h.editor,'fleetSaveV1',changed)).code,409)
  const fresh=h.packet(await h.board(),'123')
  fresh.assignments[a][0]='';fresh.assignments[c][1]='p2'
  const bad=await h.run(h.editor,'fleetSaveV1',fresh);assert.equal(bad.code,422)
  assert.ok(bad.data.errors[a] && bad.data.errors[c] && bad.data.errors[FLEET[2][0]])
  assert.equal((await h.board()).revision,3)
})
test('conflicting account, duplicate name and inactive archive are visible; interrupted transaction leaves all vehicles untouched',async()=>{
  const h=fixture({txWrite:(op,table,data)=>{if(table==='crm_users' && data?.username==='19e6t')throw Error('interruption')}})
  const b=await h.board();assert.equal((await h.run(h.admin,'fleetProvisionV1',h.packet(b,'130'))).code,503)
  assert.equal(h.tables.crm_users.length,2);assert.equal((await h.board()).revision,0)
  h.tables.crm_users.push({_id:'unrelated',username:'11mz2',role:'admin',mobile_sale_defaults:{vehicle_no:'其他'}})
  h.tables.crm_delivery_men.push({_id:'duplicate',name:NAMES[1],is_active:true});h.tables.crm_vehicles[2].is_active=false
  const conflict=await h.board();assert.ok(conflict.warnings.length);assert.equal(conflict.rows[0].status,'conflict');assert.equal(conflict.rows[2].status,'conflict')
  assert.equal((await h.run(h.admin,'fleetProvisionV1',h.packet(conflict,'131'))).code,422)
})

test('overlapping dispatch transactions report the winning rows and keep a single crew batch', async () => {
  const h = fixture()
  await h.run(h.admin, 'fleetProvisionV1', h.packet(await h.board(), '140'))
  const initial = await h.board()
  const first = h.packet(initial, '141')
  const second = h.packet(initial, '142')
  const plate = FLEET[0][0]
  first.assignments[plate] = ['p5', 'p8']
  second.assignments[plate] = ['p7', 'p6']

  // Hold both snapshots at commit, modelling the provider's conflict on the shared version document.
  const startTransaction = h.db.startTransaction
  let arrivals = 0, release
  const bothReady = new Promise(resolve => { release = resolve })
  const revision = () => h.tables.crm_operation_logs.find(row => row.action === 'vehicle_dispatch_version').detail.revision
  h.db.startTransaction = async () => {
    const snapshot = revision()
    const tx = await startTransaction()
    return { ...tx, commit: async () => {
      if (++arrivals === 2) release()
      await bothReady
      if (revision() !== snapshot) throw Error('transaction write conflict')
      return tx.commit()
    } }
  }
  const results = await Promise.all([
    h.run(h.admin, 'fleetSaveV1', first),
    h.run(h.editor, 'fleetSaveV1', second)
  ])
  assert.deepEqual(results.map(result => result.code).sort(), [0, 409])
  const conflict = results.find(result => result.code === 409)
  assert.ok(conflict.data.changed.includes(plate))
  const final = await h.board()
  const winner = results[0].code === 0 ? first : second
  assert.equal(final.revision, initial.revision + 1)
  assert.equal(final.history.filter(entry => entry.mode === 'crew').length, 1)
  for (const row of final.rows) assert.deepEqual(row.assigned, winner.assignments[row.plate])
})

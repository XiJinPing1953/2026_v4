'use strict'

const crypto = require('crypto')
const PAGE = '/pages/vehicle/dispatch'
const FLEET = [
  ['冀A11MZ2', '徐永辉'], ['冀A24036', '罗小强'], ['冀A19E6T', '王红权'],
  ['冀A38U7G', '张侨冰'], ['冀AB57Y2', '张建坡']
]
const NAMES = [...FLEET.map(([, name]) => name), '李凤荣', '郭增杰', '王浩然', '杨青青']
const TABLE = 'crm_operation_logs'
const HEAD = 'fleet_dispatch_head_v1'
const JOURNAL = 'vehicle_dispatch_batch_v1'
function stable(data) {
  if (Array.isArray(data)) return data.map(stable)
  if (data && typeof data === 'object') return Object.fromEntries(Object.keys(data).sort().map(k=>[k, stable(data[k])]))
  return data
}
const digest = data => crypto.createHash('sha256').update(JSON.stringify(stable(data))).digest('hex')
const first = result => Array.isArray(result.data) ? result.data[0] : result.data
const view = '/pages/pda/home', sale = '/pages/pda/sale-create'
const allowed = [view + ':view', sale + ':create', sale + ':view']
const noun = action => ({view:'查看',create:'新建',update:'修改',delete:'删除'}[action] || action)
const fail = (code, msg, data) => Object.assign(new Error(msg), {code, data})

async function all(query) {
  const rows = []
  for (let offset = 0; ; offset += 50) {
    const page = (await query.orderBy('_id','asc').skip(offset).limit(50).get()).data
    if (!Array.isArray(page)) throw new Error('档案未读完整')
    rows.push(...page)
    if (page.length < 50) return rows
  }
}
function compileRow(plate, preferred, vehicles, users, staff, acl) {
  const issues = [], differences = []
  const vehicleMatches = vehicles.filter(v => v.plate_no === plate)
  const vehicle = vehicleMatches.length === 1 ? vehicleMatches[0] : null
  if (!vehicle || vehicle.is_active !== true) issues.push('车辆档案缺失、重号或已停用')
  const username = plate.slice(-5).toLowerCase()
  const matches = users.filter(u => String(u.username).toLowerCase() === username ||
    (vehicle && u.mobile_sale_defaults?.vehicle_id === vehicle._id) || u.mobile_sale_defaults?.vehicle_no === plate)
  const user = matches.length === 1 ? matches[0] : null
  if (matches.length > 1) issues.push('多个账号匹配此车：' + matches.map(u => u.username).join('、'))
  const defaults = user?.mobile_sale_defaults || {}
  if (user) {
    if (user.role !== 'pda_operator' || (user.role_template && user.role_template !== 'pda_operator') || user.is_active === false) issues.push('匹配账号角色或启用状态异常，请在用户管理核实')
    if ((defaults.vehicle_id && defaults.vehicle_id !== vehicle?._id) || (defaults.vehicle_no && defaults.vehicle_no !== plate)) issues.push('账号已绑定其他车辆：' + (defaults.vehicle_no || defaults.vehicle_id))
    if (!defaults.vehicle_id || !defaults.vehicle_no) differences.push('补齐车辆绑定')
    const effective = acl.normalizePagePermissions(user.page_permissions, user.role_template || user.role)
    for (const entry of acl.PAGE_REGISTRY) {
      for (const [action, on] of Object.entries(effective[entry.pagePath])) {
        const want = allowed.includes(entry.pagePath + ':' + action)
        if (Boolean(on) !== want) differences.push((want ? '补上' : '收回') + entry.label + '·' + noun(action))
      }
    }
  }
  const candidates = staff.filter(p => p.name === preferred && p.is_active)
  const assigned = [defaults.delivery1_id || '', defaults.delivery2_id || '']
  const suggested = [...assigned]
  if (!suggested[0] && !defaults.delivery1 && candidates.length === 1) suggested[0] = candidates[0]._id
  const row = {plate, vehicleId:vehicle?._id || '', username:user?.username || username, userId:user?._id || '',
    issues, differences, assigned, assignedNames:[defaults.delivery1 || '', defaults.delivery2 || ''], suggested,
    status:issues.length ? 'conflict' : !user ? 'missing' : differences.length ? 'repair' : 'ready'}
  row.version = digest([row, defaults, matches.map(u => [u._id,u.username,u.role,u.role_template,u.is_active !== false]).sort()])
  return row
}
function crewErrors(rows, assignments, staff) {
  const valid = new Set(staff.filter(p => p.is_active).map(p => p._id))
  const used = new Map(), errors = {}
  const add = (p,msg) => { (errors[p] ||= []).push(msg) }
  for (const row of rows) {
    const crew = assignments[row.plate]
    if (!Array.isArray(crew) || crew.length !== 2 || !crew[0]) add(row.plate,'请选择司机')
    for (const id of Array.isArray(crew) ? crew : []) {
      if (!id) continue
      if (!valid.has(id)) add(row.plate,'人员档案不在启用名单')
      if (used.has(id)) {
        add(row.plate,'人员与 ' + used.get(id) + ' 重复')
        if (used.get(id) !== row.plate) add(used.get(id),'人员与 ' + row.plate + ' 重复')
      } else used.set(id,row.plate)
    }
  }
  return errors
}
function service(db, acl, buildUserDoc, hashPassword) {
  const read = async (source, table, id) => first(await (source === db ? source.collection(table).where({_id:id}).limit(1) : source.collection(table).doc(id)).get())
  const users = 'crm_users'
  async function board() {
    const [head, vehicles, people, accounts] = await Promise.all([
      read(db,TABLE,HEAD),
      all(db.collection('crm_vehicles').where({plate_no:db.command.in(FLEET.map(([plate])=>plate))}).field({plate_no:true,is_active:true})),
      all(db.collection('crm_delivery_men').where({name:db.command.in(NAMES)}).field({name:true,is_active:true})),
      all(db.collection(users).field({username:true,role:true,role_template:true,is_active:true,mobile_sale_defaults:true,page_permissions:true}))
    ])
    const staff = people.map(p=>({_id:p._id,name:p.name,is_active:p.is_active===true})).sort((a,b)=>NAMES.indexOf(a.name)-NAMES.indexOf(b.name) || a._id.localeCompare(b._id))
    const rows = FLEET.map(([plate,preferred])=>compileRow(plate,preferred,vehicles,accounts,staff,acl))
    const warnings = NAMES.flatMap(name=>{
      const count = staff.filter(s=>s.name===name && s.is_active).length
      return count===1 ? [] : [name + (count ? '有同名启用档案，请按档案编号选择' : '缺少启用档案')]
    })
    return {revision:head?.detail?.revision || 0,rows,staff,warnings}
  }
  function can(user,action) {
    return user?.is_active !== false && (acl.isSuperAdmin(user) || (user?.role !== 'safety_inspector' && user?.role_template !== 'safety_inspector' && acl.hasPagePermission(user,PAGE,'view') && acl.hasPagePermission(user,PAGE,action)))
  }
  function key(user,id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{12,96}$/.test(id)) throw fail(400,'缺少有效的批次号')
    return digest([JOURNAL,user._id,id]).slice(0,24)
  }
  function historyRow(log) {
    return {batchId:log.request_id,operator:log.detail.operator,createdAt:log.created_at,revision:log.detail.revision,mode:log.detail.mode,changes:log.detail.changes}
  }
  async function snapshot(user, before) {
    const where = {action:JOURNAL}
    if (before) where['detail.revision'] = db.command.lt(Number(before))
    const current = await board()
    const history = await db.collection(TABLE).where(where).orderBy('created_at','desc').limit(21).get()
    return {...current,history:history.data.slice(0,20).map(historyRow),moreHistory:history.data.length>20,
      canSave:can(user,'update'),canProvision:acl.isSuperAdmin(user)}
  }
  function receipt(doc, fingerprint) {
    if (fingerprint && doc.detail.fingerprint !== fingerprint) throw fail(409,'此批次已用于其他调整')
    return {code:0,data:historyRow(doc)}
  }
  async function save(user, data, provision) {
    if (!can(user,'update') || (provision && !acl.isSuperAdmin(user))) throw fail(403,'没有执行此操作的调度权限')
    const id=key(user,data.batchId)
    const mode=provision?'accounts':'crew'
    const assignments = Object.fromEntries(FLEET.map(([p])=>[p,data.assignments?.[p] || []]))
    const fingerprint=digest([mode,data.revision,FLEET.map(([p])=>data.versions?.[p]),provision ? null : assignments])
    const previous=await read(db,TABLE,id)
    if (previous) return receipt(previous,fingerprint)
    const state=await board()
    const changed=state.rows.filter(r=>r.version!==data.versions?.[r.plate]).map(r=>r.plate)
    if (state.revision!==data.revision || changed.length) {
      const done=await read(db,TABLE,id)
      if (done) return receipt(done,fingerprint)
      throw fail(409,'调度已变化，请载入最新安排再核对',{changed})
    }
    const errors=provision?{}:crewErrors(state.rows,assignments,state.staff)
    for (const row of state.rows) {
      if (row.issues.length || (!provision && row.status!=='ready')) (errors[row.plate] ||= []).push(...(row.issues.length ? row.issues : ['须先由超管备齐账号']))
    }
    if (Object.keys(errors).length) throw fail(422,'请处理车行中的提示',{errors})
    const missing=state.rows.filter(r=>r.status==='missing')
    if (provision && missing.length && (typeof data.password!=='string'||data.password.length<6||data.password.length>72)) throw fail(400,'请填写本批新账号的初始密码（6 至 72 位）')
    const hashes=new Map()
    if (provision) for (const row of missing) hashes.set(row.plate,await hashPassword(data.password))
    const minAcl=acl.normalizePagePermissions(Object.fromEntries(acl.PAGE_REGISTRY.map(e=>[e.pagePath,e.pagePath===view?{view:true}:e.pagePath===sale?{view:true,create:true}:{}])),'pda_operator')
    const tx=await db.startTransaction()
    try {
      const head=state.revision ? await read(tx,TABLE,HEAD) : null
      if ((head?.detail?.revision || 0)!==state.revision) throw fail(409,'有其他人刚刚保存了调度，请重新核对')
      const actor=await read(tx,users,user._id)
      if (!actor || actor.token!==user.token || !can(actor,'update') || (provision && !acl.isSuperAdmin(actor))) throw fail(403,'账号或调度权限已经变化')
      const now=Date.now(), changes=[]
      for (const row of state.rows) {
        const vehicle=await read(tx,'crm_vehicles',row.vehicleId)
        if (vehicle?.plate_no!==row.plate || vehicle.is_active!==true) throw fail(409,row.plate+' 车辆档案已变化')
        const existing=row.userId ? await read(tx,users,row.userId) : null
        if (row.userId) {
          if (!existing || compileRow(row.plate,FLEET.find(([p])=>p===row.plate)[1],[vehicle],[existing],state.staff,acl).version!==row.version) throw fail(409,row.plate+' 账号或人员已变化',{changed:[row.plate]})
        }
        const old=existing?.mobile_sale_defaults || {}
        let next={...old,vehicle_id:row.vehicleId,vehicle_no:row.plate}
        if (!provision) {
          const ids=assignments[row.plate]
          const people=[]
          for (const personId of ids) {
            if (!personId) { people.push('');continue }
            const person=await read(tx,'crm_delivery_men',personId)
            if (!person?.is_active || !NAMES.includes(person.name)) throw fail(409,row.plate+' 人员档案已变化')
            people.push(person.name)
          }
          next={...next,delivery1_id:ids[0],delivery2_id:ids[1],delivery1:people[0],delivery2:people[1]}
        }
        if (provision ? row.status==='ready' : JSON.stringify(old)===JSON.stringify(next)) continue
        if (existing) {
          const patch={mobile_sale_defaults:next,updated_at:now}
          if (provision) patch.page_permissions=minAcl
          await tx.collection(users).doc(existing._id).update(patch)
        } else {
          const doc=buildUserDoc({username:row.username,nickname:row.username,passwordHash:hashes.get(row.plate),roleTemplate:'pda_operator'})
          await tx.collection(users).add({...doc,_id:digest(['fleet-user',row.username]).slice(0,24),page_permissions:minAcl,mobile_sale_defaults:next})
        }
        changes.push({plate:row.plate,username:row.username,before:row.assignedNames,beforeIds:row.assigned,afterIds:[next.delivery1_id||'',next.delivery2_id||''],after:[next.delivery1||'',next.delivery2||''],status:row.status})
      }
      const revision=state.revision+1, operator=user.nickname || user.username
      const common={user_id:user._id,username:user.username,role:user.role,request_id:data.batchId,created_at:now}
      const log={...common,_id:id,action:JOURNAL,detail:{revision,operator,mode,fingerprint,changes}}
      await tx.collection(TABLE).add(log)
      if (head) await tx.collection(TABLE).doc(HEAD).update({detail:{revision},created_at:now})
      else await tx.collection(TABLE).add({...common,_id:HEAD,action:'vehicle_dispatch_version',detail:{revision}})
      await tx.commit()
      return receipt(log)
    } catch (err) {
      try {await tx.rollback()} catch {}
      const done=await read(db,TABLE,id)
      if (done) return receipt(done,fingerprint)
      if (Number.isInteger(err.code) && err.code>=400 && err.code<500 && err.code!==409) throw err
      const latest=await board()
      if (latest.revision!==state.revision) throw fail(409,'调度已由其他人保存',{changed:latest.rows.filter(r=>r.version!==data.versions?.[r.plate]).map(r=>r.plate)})
      throw err
    }
  }
  return async (user,action,data={})=>{
    try {
      if (!can(user,'view')) throw fail(403,'没有车辆调度权限')
      if (action==='fleetBoardV1') return {code:0,data:await snapshot(user,data.before)}
      if (action==='fleetResultV1') {
        const done=await read(db,TABLE,key(user,data.batchId))
        return done ? receipt(done) : {code:404,msg:'尚未找到此批次，可按原批次重试'}
      }
      if (action==='fleetSaveV1'||action==='fleetProvisionV1') return await save(user,data,action==='fleetProvisionV1')
      throw fail(400,'未知调度操作')
    } catch(err) {
      if (Number.isInteger(err.code) && err.code>=400 && err.code<500) return {code:err.code,msg:err.message,data:err.data}
      console.error('[fleet-dispatch]',action,err.code || err.name)
      return {code:503,msg:'调度服务暂时不可用，请按原批次查询结果'}
    }
  }
}
module.exports={service,compileRow,crewErrors,FLEET,NAMES}

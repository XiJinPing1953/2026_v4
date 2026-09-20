'use strict'
// One arrival can fund two ledgers. The header is not an additional cash event.
const M = require('./depositModel')
const R = require('./depositReportLocal')
const T = require('./depositTransactionLocal')
const { protectedReceipt } = require('./customerRefund')
const TABLE = 'crm_cashier_intakes', OPS = 'crm_cashier_intake_operations'
const RULE = 'cashier-intake/2026-09-20.1'
const first = res => Array.isArray(res?.data) ? res.data[0] || null : res?.data || null
const text = value => String(value == null ? '' : value).trim()
const idFor = (...values) => M.digest(values).slice(0, 24)
const withoutId = ({ _id, ...rest }) => rest
const compare = (a, b) => text(b.biz_date).localeCompare(text(a.biz_date)) || Number(b.created_at || 0) - Number(a.created_at || 0) || text(b._id).localeCompare(text(a._id))
function createService({ db, readComplete, moneyScale, resolveCustomer, hiddenIds, canWrite, canAccountant = user => ['superadmin','admin','finance'].includes(user.role_template || user.role), enabled = true }) {
  const cmd = db.command
  const full = (table, where) => readComplete(db.collection(table), where, { command: cmd, source: `cashier.${table}` })
  const one = async (table, id) => first(await db.collection(table).where({ _id: id }).limit(1).get())
  const opId = (user, operation) => idFor('cashier-operation-v2', user._id, M.operationId(operation))
  async function customerFor(id) {
    const result = await resolveCustomer(M.customerId(id))
    if (!result.ok) M.fail(result.msg || '结算客户不可用', result.code || 403)
    const customer = result.customer, hidden = await hiddenIds()
    if (result.inputCustomer?.is_hidden || hidden.includes(result.inputCustomer?._id)) M.fail('客户不可访问',403)
    if (!customer || customer.is_hidden || hidden.includes(customer._id)) M.fail('客户不可访问', 403)
    return customer
  }
  function legacy(receipt) {
    return { _id: `legacy:${receipt._id}`, intake_id: `legacy:${receipt._id}`, legacy: true,
      customer_id: receipt.customer_id, customer_name: receipt.customer_name, kind: 'gas', purpose: receipt.purpose || 'unspecified',
      amount: receipt.amount, gas_amount: receipt.amount, deposit_amount: 0, money_scale: receipt.money_scale || 2,
      receipt_id: receipt._id, deposit_entry_id: '', biz_date: receipt.biz_date, payment_method: receipt.payment_method,
      note: receipt.note || '', proof_images: receipt.proof_images || [], status: receipt.status,
      version: Number(receipt.intake_version || 1), created_at: receipt.created_at, updated_at: receipt.updated_at,
      created_by: receipt.created_by, created_by_name: receipt.created_by_name }
  }
  async function header(id) {
    if (text(id).startsWith('legacy:')) {
      const receipt = await one(M.TABLES.receipts, id.slice(7))
      if (!receipt || receipt.source_type !== 'cashier_intake' || receipt.intake_id) M.fail('旧到账记录不存在或已变更', 404)
      return legacy(receipt)
    }
    const row = await one(TABLE, text(id))
    if (!row) M.fail('到账记录不存在', 404)
    return row
  }
  function normalize(data, customer, recordedScale) {
    const command = data.command || (data.intake_id ? 'update' : 'create')
    if (!['create','update','void'].includes(command)) M.fail('到账操作无效', 400)
    const operation = M.operationId(data.operation_id), scale = recordedScale || moneyScale(customer)
    const base = { command, customer_id: customer._id, intake_id: text(data.intake_id), operation_id: operation,
      expected_version: M.version(data.expected_version ?? 0), reason: M.text(data.reason, '更正原因', {required:command !== 'create'}) }
    if (command === 'void') return base
    const kind = text(data.kind || 'gas'), purpose = text(data.purpose || 'unspecified')
    if (!['gas','deposit','mixed'].includes(kind) || !['unspecified','prepay','settlement'].includes(purpose)) M.fail('款项类型或用途无效', 400)
    const amount = M.toScaled(data.amount, scale)
    const gas = kind === 'deposit' ? 0 : M.toScaled(kind === 'gas' ? data.amount : data.gas_amount, scale)
    const deposit = kind === 'gas' ? 0 : M.toScaled(kind === 'deposit' ? data.amount : data.deposit_amount, 2)
    if (gas + deposit * 10 ** (scale - 2) !== amount) M.fail('押金与气款合计必须等于到账金额', 400)
    if (data.gas_amount != null && M.toScaled(data.gas_amount, scale, {allowZero:true}) !== gas ||
        data.deposit_amount != null && M.toScaled(data.deposit_amount, 2, {allowZero:true}) !== deposit) M.fail('拆分金额与款项类型不符', 400)
    const proofs = [...new Set((Array.isArray(data.proof_images) ? data.proof_images : []).map(x => M.text(x, '凭证', {required:true,max:1500})))]
    if (!proofs.length || proofs.length > 9 || proofs.some(x => !/^cloud:\/\//.test(x))) M.fail('请上传1至9张有效云端收款凭证', 400)
    const method = text(data.payment_method)
    if (!['cash','bank','wechat','alipay','check'].includes(method)) M.fail('请选择实际收款渠道', 400)
    return {...base, kind, purpose:kind === 'deposit' ? 'unspecified' : purpose, amount:amount / 10 ** scale,
      gas_amount:gas / 10 ** scale, deposit_amount:deposit / 100, money_scale:scale,
      biz_date:M.date(data.biz_date), payment_method:method, proof_images:proofs, note:M.text(data.note,'备注')}
  }
  async function scope(customer, original, needsDeposit) {
    // The protected reverse-link reader already includes complete customer receipts.
    // Reuse that evidence and read the independent deposit ledger concurrently.
    const [gas, deposit] = await Promise.all([
      original?.receipt_id ? T.readReceiptScope(db, customer._id, original.receipt_id)
        : full(M.TABLES.receipts, {customer_id:customer._id}).then(receipts=>({receipts,receipt:null})),
      needsDeposit ? R.readDepositSnapshot(db, customer._id) : null
    ])
    return { customer, original, receipts:gas.receipts, receipt:gas.receipt,
      links:original?.receipt_id ? gas : null, deposit }
  }
  function assertUnused(s, user) {
    const row = s.original
    if (!row || row.status !== 'posted') M.fail('仅可更正或作废有效到账记录')
    if (row.receipt_id) {
      const r = s.receipt
      if (!r || r.customer_id !== row.customer_id || r.source_type !== 'cashier_intake' || r.status !== 'posted' ||
          Number(r.amount) !== Number(row.gas_amount) || Number(r.allocated_amount || 0) !== 0 || Number(r.rounding_allocated_amount || 0) !== 0 ||
          Number(r.rounding_amount || 0) !== 0 || Number(r.unallocated_amount) !== Number(r.amount) || protectedReceipt(r) ||
          r.receipt_adjustment_status === 'pending' || s.links.allocations.length || s.links.adjustments.some(x=>x.status==='pending') || s.links.references.length)
        M.fail('该到账已有分配、退款、调整或关联，交会计核对处理')
      if (r.intake_ever_used && !canAccountant(user)) M.fail('该到账曾由会计处理，须由会计更正',403)
    }
    if (row.deposit_entry_id) {
      const original = s.deposit?.entries.find(x=>x._id===row.deposit_entry_id)
      if (!original || original.kind !== 'receive' || original.status !== 'posted' || original.amount_cents !== M.toScaled(row.deposit_amount)) M.fail('原押金流水已变化，请由会计核对')
      const laterUses = s.deposit.entries.filter(x => x.account_version > original.account_version && ['refund','transfer'].includes(x.kind))
      if (laterUses.some(x=>x.status==='posted')) M.fail('该客户押金已有后续退还或转款，交会计核对处理')
      if (laterUses.length && !canAccountant(user)) M.fail('该客户押金曾发生退还或转款，关联解除后仍须由会计更正',403)
    }
  }
  async function prepare(data, user) {
    // Resolve completed operations before dereferencing a legacy ID replaced by its header.
    const saved = await one(OPS, opId(user, data.operation_id))
    if (saved) {
      const customer = await customerFor(saved.command.customer_id)
      const input = normalize({...data, customer_id:data.customer_id || saved.command.customer_id}, customer, saved.command.money_scale)
      if (data.customer_id && data.customer_id !== saved.command.customer_id || M.digest(input) !== saved.fingerprint) M.fail('该操作号已用于不同内容，请查询原结果',409)
      return {duplicate:saved.result}
    }
    const original = data.intake_id ? await header(data.intake_id) : null
    const customer = await customerFor(data.customer_id || original?.customer_id)
    if (original && original.customer_id !== customer._id) M.fail('到账记录不属于该客户',403)
    const input = normalize(data, customer)
    if (Boolean(original) !== (input.command !== 'create')) M.fail('到账操作与原记录不符',400)
    const fingerprint = M.digest(input), operationKey = opId(user,input.operation_id)
    if (!enabled && input.command === 'create' && data.rehearse !== true) M.fail('新到账登记暂时关闭；原记录仍可查询和处理',403)
    if (!canWrite(user,input.command)) M.fail('没有该到账操作权限',403)
    if (original && input.expected_version !== original.version) M.fail('到账版本已变化，请重新查询预览')
    const s = await scope(customer,original,Boolean(input.deposit_amount || original?.deposit_amount))
    if (original) assertUnused(s,user)
    const snapshot = M.digest(s)
    if (data.expected_snapshot && data.expected_snapshot !== snapshot) M.fail('预览后到账或账务已变化，请重新预览')
    const now = Date.now(), version = (original?.version || 0) + 1
    const id = original && !original.legacy ? original._id : idFor('cashier-arrival-v2',original?._id || operationKey)
    let depositState = s.deposit, depositChanges = []
    const changeDeposit = (command, suffix) => {
      const i = {operation_id:`intake-${operationKey}-${suffix}`,expected_version:depositState.version,command}
      const change = T.buildChange(depositState,i,user,now)
      depositChanges.push(change)
      const entries = depositState.entries.map(x=>change.originalAfter?._id===x._id ? change.originalAfter : x).concat(change.entry)
      depositState = {...depositState,entries,account:change.account,balance_cents:change.account.balance_cents,version:change.account.version}
      return change.entry._id
    }
    if (original?.deposit_entry_id) changeDeposit({action:'void',customer_id:customer._id,entry_id:original.deposit_entry_id,reason:input.reason},'void')
    let depositId = ''
    if (input.command !== 'void' && input.deposit_amount) depositId = changeDeposit({action:'create',customer_id:customer._id,kind:'receive',
      amount_cents:M.toScaled(input.deposit_amount),biz_date:input.biz_date,payment_method:input.payment_method,
      voucher_ref:id,note:input.note,intake_id:id,source_type:'cashier_intake',proof_images:input.proof_images},'receive')
    const receiptId = input.command !== 'void' && input.gas_amount ? idFor('cashier-gas-v2',id,version) : ''
    const receipt = receiptId ? {_id:receiptId,customer_id:customer._id,customer_name:customer.name,amount:input.gas_amount,
      allocated_amount:0,unallocated_amount:input.gas_amount,rounding_amount:0,rounding_allocated_amount:0,
      entry_kind:'prepay',allocation_mode:'period',allocation_start_date:input.biz_date,allocation_end_date:input.biz_date,allocation_targets:[],
      source_type:'cashier_intake',source_id:id,intake_id:id,intake_version:version,purpose:input.purpose,money_scale:input.money_scale,
      biz_date:input.biz_date,payment_method:input.payment_method,proof_images:input.proof_images,proof_images_count:input.proof_images.length,note:input.note,
      status:'posted',request_id:input.operation_id,created_at:now,updated_at:now,created_by:original?.created_by || user._id,created_by_name:original?.created_by_name || user.name || user.username || '',updated_by:user._id} : null
    const row = input.command==='void' ? {...original,_id:id,intake_id:id,legacy:false,status:'void',version,updated_at:now,void_reason:input.reason,void_by:user._id,void_at:now}
      : {...input,_id:id,intake_id:id,legacy:false,customer_name:customer.name,receipt_id:receiptId,deposit_entry_id:depositId,
        status:'posted',version,created_at:original?.created_at || now,updated_at:now,created_by:original?.created_by || user._id,
        created_by_name:original?.created_by_name || user.name || user.username || '',updated_by:user._id}
    // Voided legacy receipts must no longer also appear as unlinked arrivals.
    const oldReceiptPatch = s.receipt ? {status:'void',unallocated_amount:0,intake_id:id,intake_version:version,void_reason:input.reason,void_at:now,updated_at:now} : null
    let customerPatch = {updated_at:now, cash_intake_revision:operationKey}
    if (receipt || s.receipt) {
      const next = s.receipts.map(r=>r._id===s.receipt?._id ? {...r,...oldReceiptPatch} : r).concat(receipt || [])
      customerPatch = {...customerPatch,...T.prepayPatch(next)}
      if (typeof customer.receivable_balance==='number' && Number.isFinite(customer.receivable_balance)) customerPatch.net_balance = (Math.round(customer.receivable_balance*1000)-Math.round(customerPatch.prepay_balance*1000))/1000
    }
    return {input,fingerprint,operationKey,s,snapshot,row,receipt,oldReceiptPatch,depositChanges,depositState,customerPatch,now}
  }
  async function execute(p,user,{rehearse=false,failAfterWrites=0}={}) {
    if (p.duplicate) return {...p.duplicate,idempotent:true}
    if (!p.input || !p.snapshot) M.fail('请先预览',400)
    if (typeof db.startTransaction !== 'function') M.fail('当前数据库不支持事务，到账尚未登记')
    const tx = await db.startTransaction(), start=Date.now(); let committing=false
    let writes=0
    const write=async promise=>{const res=await promise;if(res?.updated!==undefined && Number(res.updated)!==1) M.fail('事务未更新预期原记录');writes++;if(rehearse && writes===failAfterWrites) throw Object.assign(Error('预定事务中断演练'),{rehearsal_interruption:true});return res}
    const result = {intake_id:p.row._id,operation_id:p.input.operation_id,status:'committed',version:p.row.version,receipt_id:p.row.receipt_id || '',deposit_entry_id:p.row.deposit_entry_id || '',idempotent:false}
    const rehearsalResult=async status=>{
      const current=await scope(await customerFor(p.s.customer._id),p.s.original?await header(p.s.original._id):null,Boolean(p.s.deposit))
      if(M.digest(current)!==p.snapshot || await one(OPS,p.operationKey) || (!p.s.original && await one(TABLE,p.row._id))) M.fail('事务演练回滚后的原值不符，请停止登记')
      return {...result,status,committed:false,writes,snapshot_verified:true,transaction_ms:Date.now()-start}
    }
    const verify = async(table, original) => {if(original && M.digest(first(await tx.collection(table).doc(original._id).get()))!==M.digest(original)) M.fail('原值已被修改，请重新预览')}
    try {
      await verify(M.TABLES.customers,p.s.customer)
      if(p.s.original&&!p.s.original.legacy) await verify(TABLE,p.s.original)
      await verify(M.TABLES.receipts,p.s.receipt)
      await verify(M.TABLES.accounts,p.s.deposit?.account)
      await write(tx.collection(M.TABLES.customers).doc(p.s.customer._id).update(p.customerPatch))
      if(p.oldReceiptPatch) await write(tx.collection(M.TABLES.receipts).doc(p.s.receipt._id).update(p.oldReceiptPatch))
      if(p.receipt) await write(tx.collection(M.TABLES.receipts).add(p.receipt))
      for(const change of p.depositChanges) {
        if(change.original) await verify(M.TABLES.entries,change.original)
        if(change.originalAfter) await write(tx.collection(M.TABLES.entries).doc(change.originalAfter._id).update(withoutId(change.originalAfter)))
        await write(tx.collection(M.TABLES.entries).add(change.entry))
      }
      if(p.depositChanges.length) {
        if(p.s.deposit.account) await write(tx.collection(M.TABLES.accounts).doc(p.depositState.account._id).update(withoutId(p.depositState.account)))
        else await write(tx.collection(M.TABLES.accounts).add(p.depositState.account))
      }
      if(p.s.original&&!p.s.original.legacy) await write(tx.collection(TABLE).doc(p.row._id).update(withoutId(p.row)))
      else await write(tx.collection(TABLE).add(p.row))
      await write(tx.collection(OPS).add({_id:p.operationKey,actor_id:user._id,operation_id:p.input.operation_id,fingerprint:p.fingerprint,
        intake_id:p.row._id,command:p.input,before:p.s.original,after:p.row,result,created_at:p.now}))
      const current = await scope(await customerFor(p.s.customer._id),p.s.original ? await header(p.s.original._id) : null,Boolean(p.s.deposit))
      if(M.digest(current)!==p.snapshot) M.fail('提交期间账务范围发生变化，请重新预览')
      if(Date.now()-start>8000) M.fail('事务预算不足，请查询原操作号后重试')
      if(rehearse) {await tx.rollback();return rehearsalResult('rehearsed_rolled_back')}
      committing=true
      await tx.commit()
      return result
    } catch(error) {
      await tx.rollback().catch(()=>{})
      if(rehearse && error.rehearsal_interruption) return rehearsalResult('interruption_rolled_back')
      if(committing) { error.details={...(error.details||{}),commit_status_unknown:true,operation_id:p.input.operation_id}; error.message='提交结果待查询，请保留原操作号：'+error.message }
      throw error
    }
  }
  function publicRow(row, receipt, account) {
    const gas = Number(row.gas_amount || 0), allocated=Number(receipt?.allocated_amount || 0), rounding=Number(receipt?.rounding_allocated_amount || 0)
    const unallocated=Number(receipt?.unallocated_amount || 0)
    const invalidGas=row.receipt_id && (!receipt || receipt.customer_id!==row.customer_id || receipt.source_type!=='cashier_intake' || Number(receipt.amount)!==gas || !Number.isFinite(Number(receipt.unallocated_amount)))
    const restricted = row.status!=='posted' ? '已作废' : invalidGas || row.receipt_id && receipt.status!=='posted' ? '气款来源状态待核'
      : receipt && (allocated || rounding || protectedReceipt(receipt) || receipt.receipt_adjustment_status==='pending' || receipt.intake_ever_used) ? '已有会计处理，请核对关联'
      : row.deposit_entry_id && (!account || account.last_entry_id!==row.deposit_entry_id) ? '押金存在后续操作，提交前须核对' : ''
    const {proof_images,expected_snapshot, ...visible}=row
    const allocationStatus=row.status==='void'?'void':invalidGas?'unknown':!gas?'deposit':unallocated>=gas?'unallocated':unallocated>0?'partial':'allocated'
    return {...visible,_id:row._id,intake_id:row._id,proof_images_count:(proof_images||[]).length,
      allocated_amount:allocated,rounding_allocated_amount:rounding,allocated_total:allocated+rounding,unallocated_amount:unallocated,
      allocation_status:allocationStatus,allocation_status_text:({unknown:'来源待核',void:'已作废',deposit:'押金已登记',unallocated:'待分配',partial:'部分分配',allocated:'已分配'})[allocationStatus],
      editable:!restricted,removable:!restricted,restriction_reason:restricted}
  }
  async function detail(data,user) {
    const row=await header(data.intake_id),customer=await customerFor(row.customer_id)
    const state=await scope(customer,row,Boolean(row.deposit_amount)),receipt=state.receipt,deposit=state.deposit
    if (state.links?.allocations.some(item=>item.customer_id!==row.customer_id)) M.fail('到账分配存在跨客户关联，详情待会计核对')
    if(row.legacy) row.money_scale=moneyScale(customer)
    const visible=publicRow(row,receipt,deposit?.account)
    try {assertUnused(state,user);visible.editable=canWrite(user,'update');visible.removable=canWrite(user,'void');visible.restriction_reason=''}
    catch(error){visible.editable=false;visible.removable=false;visible.restriction_reason=error.message}
    return {row:visible,receipt,proof_images:row.proof_images||[],
      allocation_targets:state.links?.allocations||[],deposit_entries:deposit?.entries.map(M.publicEntry)||[]}
  }
  function pagingToken(value) { return Buffer.from(JSON.stringify(value)).toString('base64') }
  function decode(value) {try{return JSON.parse(Buffer.from(value,'base64').toString())}catch(_){M.fail('分页游标无效',400)}}
  async function list(data) {
    const hidden=await hiddenIds(), customer=data.customer_id?await customerFor(data.customer_id):null
    const from=M.date(data.date_from,false),to=M.date(data.date_to,false)
    if(from&&to&&from>to) M.fail('日期范围无效',400)
    const size=Math.min(50,Math.max(1,Math.floor(Number(data.page_size||20))))
    const filters={customer_id:customer?._id||'',from,to,include_void:!!data.include_void,kind:text(data.kind),purpose:text(data.purpose),export_mode:data.export_mode === true}
    if (filters.kind && !['gas','deposit','mixed'].includes(filters.kind) || filters.purpose && !['unspecified','prepay','settlement'].includes(filters.purpose)) M.fail('款项筛选无效',400)
    if (!Number.isSafeInteger(size)) M.fail('分页大小无效',400)
    const filterHash=M.digest(filters), cursor=data.cursor?decode(data.cursor):null
    if(cursor && (!Array.isArray(cursor.last) || cursor.last.length !== 4 || !['new','legacy'].includes(cursor.last[3]) || typeof cursor.last[0] !== 'string' || !Number.isFinite(cursor.last[1]) || typeof cursor.last[2] !== 'string')) M.fail('分页游标无效',400)
    if(cursor&&cursor.filter!==filterHash) M.fail('筛选已变化，请从第一页查询',400)
    const common=[{status:cmd.in(data.include_void?['posted','void']:['posted'])}]
    if(customer) common.push({customer_id:customer._id})
    if(hidden.length) common.push({customer_id:cmd.nin(hidden)})
    if(from) common.push({biz_date:cmd.gte(from)})
    if(to) common.push({biz_date:cmd.lte(to)})
    const group=[...common], old=[...common,{source_type:'cashier_intake'},{intake_id:cmd.exists(false)}]
    if(filters.kind) group.push({kind:filters.kind})
    if(filters.purpose) group.push({purpose:filters.purpose})
    const legacyAllowed=(!filters.kind||filters.kind==='gas')&&(!filters.purpose||filters.purpose==='unspecified')
    const where=parts=>parts.length===1?parts[0]:cmd.and(parts)
    // A count plus modification watermark detects inserts/deletes/updates during export.
    const meta=async(table,parts)=>{
      const [count,latest]=await Promise.all([db.collection(table).where(where(parts)).count(),db.collection(table).where(where(parts)).orderBy('updated_at','desc').limit(1).get()])
      if(typeof count.total!=='number'||!Number.isSafeInteger(count.total)||count.total<0) M.fail('列表计数未完成')
      return {count:count.total,latest:first(latest)?.updated_at||0}
    }
    const metadata=async()=> {
      const [gm,lm]=await Promise.all([meta(TABLE,group),legacyAllowed?meta(M.TABLES.receipts,old):{count:0,latest:0}])
      let evidence = null
      if(filters.export_mode) {
        // Full evidence is intentionally limited to explicit export; normal first paint remains paged.
        const heads=await full(TABLE,where(group)), legacyRows=legacyAllowed?await full(M.TABLES.receipts,where(old)):[]
        const ids=[...new Set(heads.map(x=>x.receipt_id).filter(Boolean))], linked=[]
        const depositIds=[...new Set(heads.map(x=>x.deposit_entry_id).filter(Boolean))], depositLinks=[]
        for(let i=0;i<ids.length;i+=100) linked.push(...await full(M.TABLES.receipts,{_id:cmd.in(ids.slice(i,i+100))}))
        for(let i=0;i<depositIds.length;i+=100) depositLinks.push(...await full(M.TABLES.entries,{_id:cmd.in(depositIds.slice(i,i+100))}))
        if(heads.length!==gm.count || legacyRows.length!==lm.count || linked.length!==ids.length || depositLinks.length!==depositIds.length) M.fail('导出取数不完整或来源已变化')
        for (const receipt of [...linked, ...legacyRows]) {
          if (receipt.status !== 'posted') continue
          const amount = M.toScaled(receipt.amount, 3)
          const allocated = M.toScaled(receipt.allocated_amount, 3, {allowZero:true})
          const unallocated = M.toScaled(receipt.unallocated_amount, 3, {allowZero:true})
          if (allocated + unallocated !== amount) M.fail('气款原单分配金额不完整或不守恒，导出未完成')
        }
        const gasById=new Map(linked.map(x=>[x._id,x])), depositById=new Map(depositLinks.map(x=>[x._id,x]))
        for(const head of heads) {
          const gas=gasById.get(head.receipt_id), deposit=depositById.get(head.deposit_entry_id)
          if(Boolean(head.gas_amount)!==Boolean(gas) || Boolean(head.deposit_amount)!==Boolean(deposit) ||
            gas && (gas.intake_id!==head._id || gas.customer_id!==head.customer_id || gas.source_type!=='cashier_intake' || gas.status!==head.status || Number(gas.amount)!==Number(head.gas_amount)) ||
            deposit && (deposit.intake_id!==head._id || deposit.customer_id!==head.customer_id || deposit.kind!=='receive' || deposit.status!==head.status || deposit.amount_cents!==M.toScaled(head.deposit_amount))) M.fail('到账与气款或押金原单不一致，导出未完成')
        }
        evidence=M.digest([heads,legacyRows,linked,depositLinks])
      }
      return {gm,lm,evidence}
    }
    const before=await metadata(), snapshot=M.digest([filterHash,before]),total=before.gm.count+before.lm.count
    if(cursor&&cursor.snapshot!==snapshot) M.fail('查询期间到账记录发生变化，请重新查询或导出')
    const read=async(table,parts,type)=>{
      if(cursor?.last) {
        const [date,created,id,lastType]=cursor.last
        const rawId=type==='legacy'&&lastType==='legacy'?id.slice(7):id
        const tie=type===lastType?cmd.lt(rawId):(type==='new'?cmd.exists(true):cmd.exists(false))
        parts=[...parts,cmd.or([{biz_date:cmd.lt(date)},cmd.and([{biz_date:date},{created_at:cmd.lt(created)}]),cmd.and([{biz_date:date,created_at:created},{_id:tie}])])]
      }
      const res=await db.collection(table).where(where(parts)).orderBy('biz_date','desc').orderBy('created_at','desc').orderBy('_id','desc').limit(size+1).get()
      return (res.data||[]).map(row=>type==='legacy'?legacy(row):row)
    }
    const [a,b]=await Promise.all([read(TABLE,group,'new'),legacyAllowed?read(M.TABLES.receipts,old,'legacy'):[]])
    const sorted=[...a,...b].sort(compare), selected=sorted.slice(0,size)
    const rids=selected.map(r=>r.receipt_id).filter(Boolean), legacyCids=[...new Set(selected.filter(r=>r.legacy).map(r=>r.customer_id))],cids=[...new Set(selected.filter(r=>r.deposit_amount).map(r=>r.customer_id))]
    const [receipts,accounts,customers]=await Promise.all([rids.length?db.collection(M.TABLES.receipts).where({_id:cmd.in(rids)}).limit(100).get():{data:[]},cids.length?db.collection(M.TABLES.accounts).where({customer_id:cmd.in(cids)}).limit(100).get():{data:[]},legacyCids.length?db.collection(M.TABLES.customers).where({_id:cmd.in(legacyCids)}).limit(100).get():{data:[]}])
    const cm=new Map((customers.data||[]).map(c=>[c._id,c]))
    for(const row of selected.filter(r=>r.legacy)) { if(!cm.has(row.customer_id)) M.fail('旧到账客户资料不完整'); row.money_scale=moneyScale(cm.get(row.customer_id)) }
    if(M.digest(before)!==M.digest(await metadata())) M.fail('查询期间到账记录发生变化，请重新查询或导出')
    const rm=new Map((receipts.data||[]).map(r=>[r._id,r])),am=new Map((accounts.data||[]).map(r=>[r.customer_id,r]))
    const last=selected.at(-1),hasMore=sorted.length>size
    return {rows:selected.map(r=>publicRow(r,rm.get(r.receipt_id),am.get(r.customer_id))),paging:{total,pageSize:size,hasMore,snapshot,create_enabled:enabled,
      next_cursor:hasMore?pagingToken({filter:filterHash,snapshot,last:[last.biz_date,last.created_at,last._id,last.legacy?'legacy':'new']}):''}}
  }
  async function run(action,data,user) {
    if(data.rehearse!==undefined && typeof data.rehearse!=='boolean') M.fail('演练参数无效',400)
    if(data.rehearse && !['superadmin'].includes(user.role_template || user.role)) M.fail('仅管理员可执行回滚演练',403)
    if(data.fail_after_writes!==undefined && (!Number.isSafeInteger(data.fail_after_writes)||data.fail_after_writes<0||data.fail_after_writes>20)) M.fail('演练中断点无效',400)
    if(action==='getReceiptIntakeOperationV2') {
      const saved=await one(OPS,opId(user,data.operation_id))
      if(saved) await customerFor(saved.command.customer_id)
      return {found:!!saved,...(saved?{result:saved.result}:{}),operation_id:data.operation_id}
    }
    if(action==='listReceiptIntakeV2') return list(data)
    if(action==='getReceiptIntakeDetailV2') return detail(data,user)
    const input=action==='voidReceiptIntakeV2'?{...data,command:'void'}:data
    const p=await prepare(input,user)
    if(action==='previewReceiptIntakeV2') return p.duplicate?{committed:true,result:p.duplicate}:{submission:{...p.input,expected_snapshot:p.snapshot},operation_id:p.input.operation_id,
      before:p.s.original,after:publicRow(p.row,p.receipt,p.depositState?.account)}
    if(!data.expected_snapshot&&!p.duplicate) M.fail('请先预览取得原值校验',400)
    return execute(p,user,{rehearse:data.rehearse===true,failAfterWrites:data.fail_after_writes||0})
  }
  return {run}
}
module.exports={createService,TABLE,OPS,RULE}

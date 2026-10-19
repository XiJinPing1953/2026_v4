import { computed, reactive, ref, watch } from 'vue'
import { getUser } from '@/services/auth'
import { previewReweighV1, correctReweighV1, getReweighOperationV1, retryReweighOperationV1 } from '@/services/api/reweigh'

const weight = (value) => value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—'
const copy = (value) => JSON.parse(JSON.stringify(value))

export function useReweighCorrection({ record, canUpdate, onComplete }) {
 const accountId = String(getUser()?._id || '')
 const form = reactive({ gross_weight: '', reason: '' })
 const frozen = ref(null), operation = ref(null), busy = ref(false), error = ref(''), activeId = ref('')
 const storageKey = () => `crm:reweigh:correction:${accountId}:${activeId.value}`
 const isFrozen = computed(() => Boolean(frozen.value))
 const statusText = computed(() => {
  if (operation.value?.complete) return '更正及后续核查已完成'
  if (operation.value?.source_records?.some((item) => item.saved) || Number(operation.value?.saved_total) > 0) return '更正已保存，后续核查待完成'
  return frozen.value ? '更正提交状态待确认，请使用原编号查询或重试' : ''
 })
 function checkAccount() {
  if (!accountId || String(getUser()?._id || '') !== accountId) throw new Error('登录账号已变化，请重新打开此记录')
  if (!canUpdate.value) throw new Error('没有灌装编辑权限')
 }
 function readDraft() { const value = uni.getStorageSync(storageKey()); return value && typeof value === 'object' ? value : null }
 function saveDraft() {
  if (!activeId.value || String(getUser()?._id || '') !== accountId) return
  const saved = readDraft()
  if (saved?.payload && saved.payload.operation_id !== frozen.value?.operation_id) return
  uni.setStorageSync(storageKey(), { ...form, payload: frozen.value ? copy(frozen.value) : null })
 }
 function restoreDraft() {
  const saved = readDraft()
  frozen.value = saved?.payload || null
  form.gross_weight = String(saved?.payload?.gross_weight ?? saved?.gross_weight ?? record.value?.reweigh?.gross_weight ?? '')
  form.reason = String(saved?.payload?.reason ?? saved?.reason ?? '')
 }
 watch(() => record.value?._id, (id) => {
  if (!id || record.value?.entry_source !== 'pda_reweigh' || activeId.value === id) return
  activeId.value = id
  restoreDraft()
  if (frozen.value) refresh()
 }, { immediate: true })
 watch(() => [form.gross_weight, form.reason], saveDraft)
 async function accept(result) {
  checkAccount()
  const data = result?.data
  const saved = Number(data?.saved_total) > 0 || data?.source_records?.some((item) => item.saved)
  if (data?.rejected === true && !saved && (!data.operation_id || data.operation_id === frozen.value?.operation_id)) {
   // A rejected operation with no saved source is safe to replace, including code 0 rollback receipts.
   uni.removeStorageSync(storageKey()); frozen.value = null; saveDraft()
   throw new Error(result.msg || data.last_error || '更正未保存，请重新核对后提交')
  }
  if (result?.code !== 0) throw new Error(result?.msg || '更正状态读取失败')
  if (!frozen.value || result.data?.operation_id !== frozen.value.operation_id) throw new Error('返回的更正编号不匹配，请查询原提交状态')
  operation.value = result.data
  error.value = result.data.last_error || ''
  if (result.data.complete === true) {
   uni.removeStorageSync(storageKey()); frozen.value = null
   await onComplete()
   form.gross_weight = String(record.value?.reweigh?.gross_weight ?? ''); form.reason = ''
  }
 }
 async function refresh() {
  if (busy.value || !frozen.value) return
  busy.value = true; error.value = ''
  try { checkAccount(); await accept(await getReweighOperationV1(frozen.value.operation_id)) }
  catch (err) { error.value = err.message || '查询失败，请保留原提交' }
  finally { busy.value = false }
 }
 async function recover() {
  if (busy.value || !frozen.value) return
  busy.value = true; error.value = ''
  try {
   checkAccount()
   const status = await getReweighOperationV1(frozen.value.operation_id)
   if (status?.code === 0) {
    await accept(status)
    if (frozen.value) await accept(await retryReweighOperationV1(frozen.value.operation_id))
   } else if (Number(status?.code) === 404) await accept(await correctReweighV1(copy(frozen.value)))
   else throw new Error(status?.msg || '查询失败，请稍后使用原编号重试')
  } catch (err) { error.value = err.message || '更正状态待确认，请保留原提交' }
  finally { busy.value = false }
 }
 async function submit() {
  if (busy.value || frozen.value) return
  busy.value = true; error.value = ''; operation.value = null
  try {
   checkAccount()
   if (readDraft()?.payload) { restoreDraft(); throw new Error('此记录已有待确认更正，请先查询原提交') }
   const gross = Number(form.gross_weight), reason = form.reason.trim()
   if (!form.gross_weight.trim() || !Number.isFinite(gross) || gross <= 0) throw new Error('请填写大于 0 的更正毛重')
   if (!reason) throw new Error('请填写更正原因')
   const response = await previewReweighV1({ filling_id: record.value._id, bottle_no: record.value.bottle_no, gross_weight: gross })
   if (response?.code !== 0) throw new Error(response?.msg || '更正核对失败')
   const preview = response.data
   if (preview?.mode !== 'correct' || preview.filling?._id !== record.value._id) throw new Error('原单已变化，请重新打开记录核对')
   const old = preview.filling, delta = Number(preview.fill_weight) - Number(old.fill_weight)
   const confirmation = await uni.showModal({ title: '确认更正复秤重量',
    content: `瓶号 ${old.bottle_no}\n毛重：${weight(old.reweigh?.gross_weight)} → ${weight(preview.gross_weight)} kg\n净重：${weight(old.reweigh?.net_weight)} → ${weight(preview.net_weight)} kg\n本次灌装量：${weight(old.fill_weight)} → ${weight(preview.fill_weight)} kg（${delta > 0 ? '+' : ''}${weight(delta)} kg）\n原因：${reason}`,
    confirmText: '确认更正', cancelText: '返回核对' })
   if (!confirmation.confirm) return
   const dispatch = async () => {
    checkAccount()
    if (readDraft()?.payload) { restoreDraft(); throw new Error('此记录已有待确认更正，请先查询原提交') }
    frozen.value = { operation_id: `reweigh_manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 13)}`,
     filling_id: old._id, bottle_no: old.bottle_no, date: preview.date, gross_weight: preview.gross_weight,
     context_hash: preview.context_hash, expected_source_version: Number(old.source_version || 0), capture_method: 'manual', reason }
    form.gross_weight = String(preview.gross_weight); form.reason = reason
    try { saveDraft() } catch (_) { frozen.value = null; throw new Error('本地草稿保存失败，请释放空间后重试') }
    await accept(await correctReweighV1(copy(frozen.value)))
   }
   if (typeof navigator !== 'undefined' && navigator.locks?.request) await navigator.locks.request(storageKey(), dispatch)
   else await dispatch()
  } catch (err) { error.value = err.message || '更正状态待确认，请保留原提交' }
  finally { busy.value = false }
 }
 return { form, frozen, operation, busy, error, isFrozen, statusText, submit, refresh, recover }
}

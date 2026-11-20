import { ref, onBeforeUnmount } from 'vue'
import { getUser, onAuthIdentityChange } from '@/services/auth'
import { ensurePdaBleRuntimePermission } from '@/services/pda/bleScale'
import { createLabelPrinterSession } from '@/services/pda/labelPrinter'
import { selectPairedPrinter, rememberPrinter } from '@/services/pda/printerSelection'
import { getPdaSale } from '@/services/pda/saleRecords'
import { salePrintPages, writeSalePage } from '@/services/pda/salePrint'
// Reuse a successful selection for this login only. Each page owns its native session.
let recentPrinter = null
onAuthIdentityChange(user => {
 if (recentPrinter && user?._id !== recentPrinter.owner) recentPrinter = null
})
export function usePdaSalePrinter(active) {
 const owner=String(getUser()?._id||''), valid=()=>active()&&owner&&owner===String(getUser()?._id||'')
 const status=ref('打印机未连接'),busy=ref(false),connecting=ref(false),connected=ref(false)
 let session=null,connectionEpoch=0,printEpoch=0,timer=null,printerAddress=''
 const eligible=new Set()
 let unsubscribeIdentity = null
 function close() {
  connectionEpoch++
  printEpoch++
  unsubscribeIdentity?.()
  unsubscribeIdentity = null
  clearInterval(timer)
  timer = null
  session?.close()
  session = null
  printerAddress = ''
  connected.value = false
  connecting.value = false
  status.value = '打印机未连接'
  eligible.clear()
 }
 async function connectDevice(previous) {
  if (!valid() || busy.value || connecting.value || (previous && connected.value)) return
  close()
  const ticket = connectionEpoch
  connecting.value = true
  function current() {
   if (ticket !== connectionEpoch) return false
   if (valid()) return true
   close()
   return false
  }
  unsubscribeIdentity = onAuthIdentityChange(user => {
   if (ticket === connectionEpoch && String(user?._id || '') !== owner) close()
  })
  try {
   const permission = await ensurePdaBleRuntimePermission()
   if (!current()) return
   if (permission.code !== 0) throw Error(permission.msg)
   const device = previous || await selectPairedPrinter({android:plus.android, ui:uni, valid:current})
   if (!current()) return
   if (!device) { close(); return }
   printerAddress = device.address
   status.value = '正在连接 ' + device.name
   session = createLabelPrinterSession(uni.requireNativePlugin('TH-PlatformBLE'), state => {
    if (!current()) return
    connected.value = state.connected
    connecting.value = Boolean(state.connecting)
    status.value = state.connected ? '已连接 ' + device.name : state.message
    if (state.connected) {
     rememberPrinter(uni, device)
     recentPrinter = { owner, device }
    }
   })
   timer = setInterval(current, 1000)
   session.connect(device.address)
  } catch (error) {
   if (!current()) return
   close()
   status.value = error.message
  }
 }
 function connect() { return connectDevice(null) }
 function resume() {
  if (recentPrinter?.owner === owner) return connectDevice(recentPrinter.device)
 }
 function stop() {
  printEpoch++
  status.value = connected.value ? '已停止；已发送的页请查看出纸' : '打印机已断开，打印已停止；请核对已出纸页后重连'
 }
 async function print(id,{automatic=false,operationId=''}={}){if(!valid()||busy.value)return;const key=`pda_sale_print_v1:${owner}:${operationId||id}`
 busy.value=true;const ticket=printEpoch;let sent=0
 try{if(automatic){if(!eligible.has(operationId))return;eligible.delete(operationId);if(uni.getStorageSync(key))return;uni.setStorageSync(key,'attempted');if(uni.getStorageSync(key)!=='attempted')throw Error('打印状态无法保存')}
 if(!session?.connected)throw Error('记录已保存，打印机未连接，请手动补打')
 const result=await getPdaSale(id, { shouldContinue: () => ticket === printEpoch && valid() });if(ticket!==printEpoch||!valid())return;if(result.code!==0)throw Error(result.msg)
 const pages=salePrintPages(result.data)
 for(const copy of ['留底联','客户联'])for(const page of pages){if(ticket!==printEpoch||!valid())return;if(!session?.connected)throw Error('打印已停止，请核对出纸后补打');status.value=`正在发送${copy} ${page.page}/${page.total}`;await session.sendDocument(()=>writeSalePage(plus.android,page,printerAddress,copy));sent++}
 if(ticket===printEpoch)status.value=`已发送两联（留底联、客户联），共 ${sent} 页，请查看出纸`
 }catch(e){if(ticket===printEpoch)status.value=(sent?`已发送 ${sent} 页；`:'')+(e.message||'发送结果不明，请查看出纸后补打')}finally{busy.value=false}}
 onBeforeUnmount(close)
 return{status,busy,connecting,connected,connect,resume,close,stop,print,arm:id=>{if(id)eligible.add(id)},confirmed:r=>r?.sourceSaved&&r.saleId?print(r.saleId,{automatic:true,operationId:r.operationId}):null}
}

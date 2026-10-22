import { ref, onBeforeUnmount } from 'vue'
import { getUser } from '@/services/auth'
import { ensurePdaBleRuntimePermission } from '@/services/pda/bleScale'
import { createLabelPrinterSession, getPairedPrinters } from '@/services/pda/labelPrinter'
import { getPdaSale } from '@/services/pda/saleRecords'
import { salePrintPages, writeSalePage } from '@/services/pda/salePrint'
export function usePdaSalePrinter(active) {
 const owner=String(getUser()?._id||''), valid=()=>active()&&owner&&owner===String(getUser()?._id||'')
 const status=ref('打印机未连接'),busy=ref(false),connecting=ref(false),connected=ref(false)
 let session=null,epoch=0,timer=null
 const eligible=new Set()
 async function connect(){if(!valid()||busy.value||connecting.value)return;close();const ticket=epoch;connecting.value=true
 try{const permission=await ensurePdaBleRuntimePermission();if(ticket!==epoch||!valid())return;if(permission.code!==0)throw Error(permission.msg)
 const devices=getPairedPrinters(plus.android),bound=uni.getStorageSync('pda_label_printer_bound_v1'),device=devices.find(d=>d.address===bound?.address)||(devices.length===1?devices[0]:null)
 if(!device)throw Error('请先在系统蓝牙配对 HL30-AA21')
 session=createLabelPrinterSession(uni.requireNativePlugin('TH-PlatformBLE'),s=>{if(ticket!==epoch)return;if(!valid()){close();return}connected.value=s.connected;connecting.value=Boolean(s.connecting);status.value=s.message;if(s.connected)try{uni.setStorageSync('pda_label_printer_bound_v1',device)}catch(_){}})
 timer=setInterval(()=>{if(!valid())close()},1000);session.connect(device.address)
 }catch(e){if(ticket===epoch){session?.close();session=null;status.value=e.message;connecting.value=false}} }
 function close(){epoch++;clearInterval(timer);session?.close();session=null;connected.value=false;connecting.value=false;eligible.clear()}
 function stop(){epoch++;status.value='已停止；已发送的页请查看出纸'}
 async function print(id,{automatic=false,operationId=''}={}){if(!valid()||busy.value)return;const key=`pda_sale_print_v1:${owner}:${operationId||id}`
 busy.value=true;const ticket=epoch
 try{if(automatic){if(!eligible.has(operationId))return;eligible.delete(operationId);if(uni.getStorageSync(key))return;uni.setStorageSync(key,'attempted');if(uni.getStorageSync(key)!=='attempted')throw Error('打印状态无法保存')}
 if(!session?.connected)throw Error('记录已保存，打印机未连接，请手动补打')
 const result=await getPdaSale(id, { shouldContinue: () => ticket === epoch && valid() });if(ticket!==epoch||!valid())return;if(result.code!==0)throw Error(result.msg)
 const pages=salePrintPages(result.data)
 for(const page of pages){if(ticket!==epoch||!valid())return;if(!session?.connected)throw Error('打印已停止，请核对出纸后补打');await session.sendDocument(plugin=>writeSalePage(plugin,page))}
 if(ticket===epoch)status.value=`已发送 ${pages.length} 页，请查看出纸`
 }catch(e){if(ticket===epoch)status.value=e.message||'发送结果不明，请查看出纸后补打'}finally{busy.value=false}}
 onBeforeUnmount(close)
 return{status,busy,connecting,connected,connect,close,stop,print,arm:id=>{if(id)eligible.add(id)},confirmed:r=>r?.sourceSaved&&r.saleId?print(r.saleId,{automatic:true,operationId:r.operationId}):null}
}

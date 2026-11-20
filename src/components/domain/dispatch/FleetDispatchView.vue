<template>
  <AppPage title="车辆调度" icon="truck">
    <view class="dispatch">
      <view v-if="message" class="notice" role="status">{{ message }}</view>
      <view v-if="!board"><text>{{ busy ? '正在读取车辆和账号…' : '未能读取调度表。' }}</text><button v-if="!busy" @click="reload">重新读取</button></view>
      <template v-else>
        <view class="heading"><view><text class="title">当前出车安排</text><text class="muted">共 {{ board.rows.length }} 辆车 · 保存后从下一张销售单生效</text></view>
          <button v-if="board.canSave" class="primary" :disabled="locked || !valid || !changed || needsAccounts" @click="begin('crew')">保存调度</button>
        </view>
        <view v-for="warning in board.warnings" :key="warning" class="notice">{{ warning }}</view>
        <view class="sheet">
          <view class="row labels"><text>车辆 / 账号</text><text>司机</text><text>随车搭档</text><text>账号状态</text></view>
          <view v-for="row in board.rows" :key="row.plate" class="entry">
            <view class="row">
              <view><text class="plate">{{ row.plate }}</text><text class="muted">{{ row.username }}</text></view>
              <label v-for="(label,i) in ['司机','搭档']" :key="label"><span class="mobile-label">{{ label }}</span>
                <select :aria-label="row.plate + label" :disabled="locked || !board.canSave" v-model="crew[row.plate][i]">
                  <option value="">{{ i ? '无搭档' : '选择司机' }}</option>
                  <option v-for="s in choices" :key="s._id" :value="s._id">{{ staffLabel(s) }}</option>
                  <option v-if="crew[row.plate][i] && !choices.some(s=>s._id===crew[row.plate][i])" :value="crew[row.plate][i]" disabled>{{ row.assignedNames[i] || '无效档案' }}（须重选）</option>
                </select>
              </label>
              <text :class="row.status==='ready'?'ready':'issue'">{{ statuses[row.status] }}</text>
            </view>
            <text v-if="!row.assigned[0] && row.suggested[0]" class="hint">司机按首次名单预填，待保存</text>
            <text v-for="msg in errors[row.plate] || []" :key="msg" class="issue line">{{ msg }}</text>
            <text v-for="msg in [...row.issues,...row.differences]" :key="msg" class="issue line">{{ msg }}</text>
          </view>
        </view>
        <view class="tools" v-if="board.canSave">
          <label>互换司机 <select v-model="swapA" :disabled="locked" aria-label="第一辆车"><option value="">选择车辆</option><option v-for="r in board.rows" :key="r.plate">{{ r.plate }}</option></select></label>
          <label><span class="muted">与</span> <select v-model="swapB" :disabled="locked" aria-label="第二辆车"><option value="">选择车辆</option><option v-for="r in board.rows" :key="r.plate">{{ r.plate }}</option></select></label>
          <button :disabled="locked || !swapA || !swapB || swapA===swapB" @click="swap">互换</button>
        </view>
        <text class="line"><b>未派车人员</b>　{{ freeStaff.map(staffLabel).join('、') || '全部已安排' }}</text>
        <view v-if="needsAccounts && board.canProvision" class="tools">
          <label v-if="missing">新账号初始密码 <input type="password" v-model="password" autocomplete="new-password" placeholder="输入本批约定密码" /></label>
          <button :disabled="locked || board.rows.some(r=>r.issues.length) || (missing && password.length<6)" @click="begin('accounts')">预检并补齐车辆账号</button>
        </view>
        <view v-if="pending" class="tools"><text>有一批操作等待核实。</text><button :disabled="busy" @click="recover">查询批次结果</button><button v-if="retryable" :disabled="busy" @click="sendPending">按原批次重试</button></view>
        <button v-if="conflict && !pending" :disabled="busy" @click="reload">载入最新安排并重新核对</button>
        <view class="history"><text class="title">调整记录</text>
          <text v-if="!history.length" class="muted">暂无调整记录</text>
          <view v-for="h in history" :key="h.batchId" class="record">
            <text><b>{{ h.operator }}</b> · {{ h.mode==='accounts'?'批量配置车辆账号':'保存调度' }}</text><text class="muted">{{ formatTime(h.createdAt) }}</text>
            <text class="line" v-for="c in h.changes" :key="c.plate">{{ c.plate }}　{{ h.mode==='accounts' ? (c.status==='missing'?'已创建账号 ':'已校正账号 ') + c.username : ((c.before.filter(Boolean).join('、') || '未安排') + ' → ' + c.after.filter(Boolean).join('、')) }}</text>
          </view><button v-if="hasMore" :disabled="busy" @click="older">更早记录</button>
        </view>
      </template>
    </view>
  </AppPage>
</template>
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import { dispatchRequest } from '@/services/api/fleetDispatch'
import { getUser, getToken } from '@/services/auth'

const owner=getUser()?._id, token=getToken(), key='crm_fleet_pending_v1_'+owner
const board=ref(null), crew=ref({}), pending=ref(null), history=ref([]), hasMore=ref(false)
const busy=ref(false), conflict=ref(false), message=ref(''), password=ref(''), retryable=ref(false)
const swapA=ref(''), swapB=ref('')
let alive=true
const current=()=>alive && owner && getUser()?._id===owner && getToken()===token
const locked=computed(()=>busy.value || !!pending.value || conflict.value)
const choices=computed(()=>board.value?.staff.filter(p=>p.is_active) || [])
const freeStaff=computed(()=>choices.value.filter(s=>!Object.values(crew.value).flat().includes(s._id)))
const missing=computed(()=>board.value?.rows.some(r=>r.status==='missing'))
const needsAccounts=computed(()=>board.value?.rows.some(r=>r.status!=='ready'))
const statuses={ready:'已绑定',missing:'待开通',repair:'待校正',conflict:'需核对'}
const changed=computed(()=>board.value?.rows.some(r=>JSON.stringify(crew.value[r.plate])!==JSON.stringify(r.assigned)))
const errors=computed(()=>{
  const issues={}, used=new Map()
  const add=(plate,msg)=>{(issues[plate] ||= new Set()).add(msg)}
  for(const [plate,ids] of Object.entries(crew.value)){
    if(!ids[0]) add(plate,'请选择司机')
    for(const id of ids.filter(Boolean)){
      const person=choices.value.find(s=>s._id===id)
      if(!person) add(plate,'人员档案已停用或超出名单，请重新选择')
      if(used.has(id)){
        const other=used.get(id)
        const msg=(person?.name || '该人员')+(other===plate?'不能兼任同车两个位置':'同时安排在 '+other+' 和 '+plate)
        add(plate,msg);add(other,msg)
      } else used.set(id,plate)
    }
  }
  return Object.fromEntries(Object.entries(issues).map(([p,set])=>[p,[...set]]))
})
const valid=computed(()=>!Object.keys(errors.value).length)
function staffLabel(p){return choices.value.filter(x=>x.name===p.name).length>1?p.name+' · '+p._id.slice(-6):p.name}
function formatTime(ms){return new Date(ms).toLocaleString('zh-CN',{hour12:false})}
function swap(){const a=crew.value[swapA.value],b=crew.value[swapB.value];[a[0],b[0]]=[b[0],a[0]]}
function showBoard(value){
  board.value=value
  crew.value=Object.fromEntries(value.rows.map(r=>[r.plate,[...r.suggested]]))
  history.value=value.history;hasMore.value=value.moreHistory;conflict.value=false
}
async function fetchBoard(){
  const r=await dispatchRequest('fleetBoardV1')
  if(!current())return
  if(r.code!==0)throw Error(r.msg || '读取失败')
  showBoard(r.data)
}
async function work(fn){
  if(busy.value || !current())return
  busy.value=true
  try{await fn()}catch(e){if(current())message.value=e.message || '网络异常，请重试'}finally{if(alive)busy.value=false}
}
function reload(){return work(async()=>{message.value='';await fetchBoard()})}
function older(){return work(async()=>{
  const r=await dispatchRequest('fleetBoardV1',{before:history.value[history.value.length-1]?.revision})
  if(!current())return
  if(r.code!==0)throw Error(r.msg)
  history.value.push(...r.data.history);hasMore.value=r.data.moreHistory
})}
function begin(mode){return work(async()=>{
  if(pending.value || conflict.value)return
  const rows=board.value.rows
  const changes=rows.filter(r=>mode==='accounts'?r.status!=='ready':JSON.stringify(crew.value[r.plate])!==JSON.stringify(r.assigned))
  const text=changes.map(r=>r.plate+'　'+(mode==='accounts'?(r.status==='missing'?'开通 '+r.username:r.differences.join('、')):crew.value[r.plate].map(id=>choices.value.find(p=>p._id===id)?.name).filter(Boolean).join('、'))).join('\n')
  const answer=await new Promise(resolve=>uni.showModal({title:mode==='accounts'?'确认车辆账号配置':'确认五车调度',content:text,success:resolve,fail:()=>resolve({confirm:false})}))
  if(!answer.confirm || !current())return
  const packet={mode,batchId:'fleet_'+crypto.randomUUID(),revision:board.value.revision,versions:Object.fromEntries(rows.map(r=>[r.plate,r.version]))}
  if(mode==='crew')packet.assignments=JSON.parse(JSON.stringify(crew.value))
  uni.setStorageSync(key,packet);pending.value=packet;retryable.value=false
  await transmit()
})}
function clearPending(){uni.removeStorageSync(key);pending.value=null;retryable.value=false}
async function finished(note){
  clearPending();password.value='';message.value=note
  await fetchBoard()
}
async function transmit(){
  const p=pending.value
  if(!p)return
  const r=await dispatchRequest(p.mode==='crew'?'fleetSaveV1':'fleetProvisionV1',{...p,...(p.mode==='accounts'?{password:password.value}:{})})
  if(!current())return
  if(r.code===0)return finished(p.mode==='accounts'?'车辆账号已核实，请核对人员后保存调度。':'调度已保存。')
  if([400,403,409,422].includes(r.code)){
    clearPending()
    conflict.value=r.code===409
    message.value=[r.msg,...(r.data?.changed || []),...Object.entries(r.data?.errors || {}).map(([plate,msg])=>plate+' '+msg.join('、'))].join('　')
  }else message.value='结果尚待核实，请查询原批次。'
}
function sendPending(){return work(transmit)}
function recover(){return work(checkReceipt)}
async function checkReceipt(){
  if(!pending.value)return
  const r=await dispatchRequest('fleetResultV1',{batchId:pending.value.batchId})
  if(!current())return
  if(r.code===0)return finished('已核实，这批操作已保存。')
  retryable.value=r.code===404;message.value=r.msg || '查询失败，请重试'
}
onMounted(()=>work(async()=>{pending.value=uni.getStorageSync(key)||null;await fetchBoard();if(current() && pending.value)await checkReceipt()}))
onBeforeUnmount(()=>{alive=false;password.value=''})
</script>
<style scoped>
.dispatch{max-width:1100px;margin:auto;color:#17312e;padding:24px 16px 60px;font-family:inherit}
.heading,.tools{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.heading{justify-content:space-between;margin-bottom:20px}
.title{display:block;font-weight:700;font-size:23px}.muted,.hint{display:block;color:#566d69;font-size:13px;margin-top:4px}
.sheet,.history{border:1px solid #d5dfdc;border-radius:10px;background:white;overflow:hidden}
.row{display:grid;grid-template-columns:1.3fr 1fr 1fr .8fr;align-items:center;gap:18px}
.labels{padding:10px 18px;background:#edf3f0;color:#44605b;font-size:13px}.entry{padding:13px 18px;border-top:1px solid #e2e8e5}
.plate{font-size:17px;font-weight:700;letter-spacing:.02em}.ready{color:#166553}.issue{color:#963e21}.issue.line{font-size:13px;margin-top:5px}
.mobile-label{display:none}.tools{margin:18px 0}.line{display:block}.history{margin-top:24px;padding:18px}.record{padding:12px 0;border-bottom:1px solid #e2e8e5}
button{margin:0;font:inherit;font-size:14px;line-height:1.3;padding:9px 14px;border-radius:6px}button.primary{background:#176855;color:white}button[disabled]{opacity:.55}
select,input{font:inherit;color:inherit;background:white;border:1px solid #a0b4ad;border-radius:5px;padding:8px;max-width:100%;box-sizing:border-box}.row select{width:100%}.tools input{display:inline-block;height:36px;vertical-align:middle}
.notice{background:#fff3de;color:#684819;padding:11px 14px;margin-bottom:14px;border-radius:6px}
@media(max-width:650px){.dispatch{padding:12px 4px}.labels{display:none}.row{grid-template-columns:1fr 1fr;gap:8px}.row>view{grid-column:1}.row>text{grid-column:2;grid-row:1;text-align:right}.mobile-label{display:block;font-size:12px;color:#566d69}.entry{padding:12px}.title{font-size:20px}}
</style>

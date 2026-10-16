<template>
  <SafetyManagementShell title="安全管理配置" subtitle="明确启用日期、实际业务岗位和适用专用设施">
    <view v-if="loading" class="sm-state">正在读取配置…</view><view v-else-if="error" class="sm-alert sm-alert--error">{{ error }}</view>
    <view v-else class="sm-stack"><view v-if="warnings.length" class="sm-alert"><text class="sm-text">配置已保存，以下账号仍需在用户管理授权对应页面：</text><text v-for="(warning,index) in warnings" :key="index" class="sm-text">• {{ warning }}</text></view><view class="sm-alert sm-alert--info">本配置不完成签字授权或正式签认。业务岗位决定台账填写权限；管理员仅有配置权限时，不能代替安全员、总监或负责人填写业务结论。</view>
      <view class="sm-card"><text class="sm-h2">启用范围</text><label class="sm-field"><text class="sm-field-label">厂站</text><text class="sm-text">{{ config.station_name }} · {{ config.station_id }}</text></label><view class="sm-field"><text class="sm-field-label">启用日期 *</text><picker mode="date" :value="config.enabled_from" :disabled="!canConfigure" @change="config.enabled_from=$event.detail.value"><view class="sm-picker">{{ config.enabled_from || '选择开始要求每日巡检的日期' }}</view></picker><text class="sm-help">启用后每天均为应检日，包括节假日。旧日期不会自动生成检查记录。</text></view></view>
      <view v-for="role in roles" :key="role.key" class="sm-card"><text class="sm-h2">{{ role.label }}</text><text class="sm-help">{{ role.help }}</text><view class="sm-options sm-settings-accounts"><view v-for="user in users" :key="user._id" :class="['sm-option',{'sm-option--active':hasRole(role.key,user._id)}]" @click="toggleRole(role.key,user._id)">{{ user.name || user.username }}<text v-if="user.name && user.username">（{{ user.username }}）</text></view></view><text v-if="!users.length" class="sm-help">当前账号无权读取可配置账号列表。</text><text class="sm-help">已选 {{ config.roles[role.key]?.length || 0 }} 个实际账号</text></view>
      <view class="sm-card"><text class="sm-h2">S14 适用专用设施</text><text class="sm-help">仅填写厂站实际具备、已经明确适用的设施名称。留空时补充检查仍需明确填写“不适用”并说明原因。</text><view v-for="(equipment,index) in config.special_equipment" :key="index" class="sm-row sm-field"><input v-model="config.special_equipment[index]" class="sm-input sm-equipment-input" :disabled="!canConfigure" placeholder="设施名称 / 编号" /><button v-if="canConfigure" class="sm-btn sm-btn--secondary sm-btn--small" @click="config.special_equipment.splice(index,1)">移除</button></view><button v-if="canConfigure" class="sm-btn sm-btn--secondary" @click="config.special_equipment.push('')">添加实际设施</button></view>
      <SafetyRevisionHistory kind="config" :record-id="config._id" title="配置修订历史" />
      <view v-if="canConfigure" class="sm-card"><label class="sm-field"><text class="sm-field-label">{{ config.revision ? '修改原因 *' : '配置说明' }}</text><textarea v-model="reason" class="sm-textarea" placeholder="说明岗位、启用日期或适用设施的调整依据" /></label><button class="sm-btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存配置' }}</button></view>
    </view>
  </SafetyManagementShell>
</template>
<script setup>
import { computed,onMounted,ref } from 'vue'
import SafetyManagementShell from './SafetyManagementShell.vue'
import SafetyRevisionHistory from './SafetyRevisionHistory.vue'
import { getSafetyConfig,saveSafetyConfig } from '@/services/safetyManagement'
import { showError } from './helpers'
const loading=ref(true),saving=ref(false),error=ref(''),config=ref({roles:{safety_officer:[],safety_director:[],principal:[]},special_equipment:[]}),users=ref([]),permissions=ref({}),reason=ref(''),warnings=ref([])
const roles=[{key:'safety_officer',label:'安全员',help:'现场巡检、补充检查与日表内容核对。'},{key:'safety_director',label:'安全总监',help:'组织周排查，填写排查结果、质量评价与下周计划。'},{key:'principal',label:'主要负责人',help:'组织月调度，填写实际会议内容和决议。'}]
const canConfigure=computed(()=>permissions.value.configure)
function hasRole(role,id){return config.value.roles[role]?.includes(id)}
function toggleRole(role,id){if(!canConfigure.value)return;const current=config.value.roles[role] || [];config.value.roles[role]=current.includes(id)?current.filter(item=>item!==id):[...current,id]}
async function load(){loading.value=true;try{const result=await getSafetyConfig();config.value={...config.value,...result.config,roles:{...config.value.roles,...result.config?.roles},special_equipment:result.config?.special_equipment || []};users.value=result.users || [];permissions.value=result.permissions || {}}catch(err){error.value=err.message}finally{loading.value=false}}
async function save(){saving.value=true;try{const saved=await saveSafetyConfig({expected_revision:config.value.revision || 0,config:config.value,revision_reason:reason.value});warnings.value=saved.warnings || [];reason.value='';await load();uni.showToast({title:warnings.value.length?'配置已保存，请处理页面权限提示':'配置已保存',icon:warnings.value.length?'none':'success'})}catch(err){showError(err)}finally{saving.value=false}}
onMounted(load)
</script>
<style scoped>.sm-settings-accounts { margin-top:20rpx; }.sm-equipment-input { flex:1; min-width:0; }</style>

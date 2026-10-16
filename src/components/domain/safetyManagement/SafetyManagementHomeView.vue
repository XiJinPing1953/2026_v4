<template>
  <SafetyManagementShell title="安全管理工作台" home>
    <view v-if="loading" class="sm-state">正在读取安全管理台账…</view>
    <view v-else-if="error" class="sm-card"><text class="sm-alert sm-alert--error">{{ error }}</text><button class="sm-btn" @click="load">重新加载</button></view>
    <view v-else class="sm-stack">
      <view class="sm-card sm-home-overview"><view><text class="sm-h2">{{ config.station_name || '厂站安全管理' }}</text><text class="sm-help">{{ config.enabled_from ? `从 ${config.enabled_from} 起，每个自然日均应巡检` : '尚未设置启用日期，请先配置业务岗位与启用日期' }}</text></view><view class="sm-actions"><button class="sm-btn" @click="openSafetyPage('daily',{date:today})">今天的日管控</button><button class="sm-btn sm-btn--secondary" @click="startInspection">开始厂站巡检</button></view></view>
      <view class="sm-alert sm-alert--info">签字方式暂缓确定。台账核对后显示“待签认”；签字待办不计为漏检，历史没有证据的日期不补造记录。</view>
      <view class="sm-home-nav">
        <view class="sm-card sm-nav-card" @click="openSafetyPage('weekly',{date:today})"><text class="sm-tag">每周</text><text class="sm-h2">周排查报告</text><text class="sm-help">核验执行质量、分析反复问题、安排下周工作</text><text class="sm-link">进入周排查 →</text></view>
        <view class="sm-card sm-nav-card" @click="openSafetyPage('monthly',{month:today.slice(0,7)})"><text class="sm-tag">每月</text><text class="sm-h2">月调度纪要</text><text class="sm-help">记录真实会议、总结安全情况、跟踪决议落实</text><text class="sm-link">进入月调度 →</text></view>
        <view class="sm-card sm-nav-card" @click="openHazards"><text class="sm-tag">共同台账</text><text class="sm-h2">隐患与整改</text><text class="sm-help">检查、补充与周排查共用隐患整改流程</text><text class="sm-link">查看整改台账 →</text></view>
      </view>
      <view class="sm-card">
        <view class="sm-section-head"><text class="sm-h2">日管控日历</text><view class="sm-row"><button class="sm-btn sm-btn--secondary sm-btn--small" @click="changeMonth(-1)">上月</button><text>{{ month }}</text><button class="sm-btn sm-btn--secondary sm-btn--small" @click="changeMonth(1)">下月</button></view></view>
        <view class="sm-calendar-legend"><text v-for="state in legend" :key="state.value" :class="['sm-tag',state.class]">{{ state.label }}</text></view>
        <view class="sm-calendar"><text v-for="day in ['一','二','三','四','五','六','日']" :key="day" class="sm-calendar-week">{{ day }}</text><view v-for="blank in leadingDays" :key="`blank-${blank}`" /><view v-for="day in days" :key="day.date" :class="['sm-calendar-day',`sm-calendar-day--${day.status}`,{'sm-calendar-day--today':day.date===today}]" @click="openSafetyPage('daily',{date:day.date})"><text class="sm-calendar-date">{{ Number(day.date.slice(-2)) }}</text><text class="sm-calendar-state">{{ stateLabel(day.status) }}</text><text v-if="day.inspection_count" class="sm-calendar-count">{{ day.inspection_count }} 次巡检<span v-if="day.issue_count"> · {{ day.issue_count }} 项问题</span></text></view></view>
        <text class="sm-help">一天多次巡检归入同一日表；当天已整改的问题仍保留。点选日期查看原记录、补充检查与修订状态。</text>
      </view>
      <view class="sm-card"><view class="sm-section-head"><text class="sm-h2">岗位与启用配置</text><button v-if="permissions.configure" class="sm-btn sm-btn--secondary sm-btn--small" @click="openSafetyPage('settings')">配置</button></view><text class="sm-text">安全员 {{ roleCount('safety_officer') }} 人 · 安全总监 {{ roleCount('safety_director') }} 人 · 主要负责人 {{ roleCount('principal') }} 人</text><text class="sm-help">实际账号与业务岗位分别配置，系统超级管理员身份不代替任何业务岗位。</text></view>
    </view>
  </SafetyManagementShell>
</template>
<script setup>
import { computed,onMounted,ref } from 'vue'
import SafetyManagementShell from './SafetyManagementShell.vue'
import { getSafetyConfig,listSafetyDaily } from '@/services/safetyManagement'
import { beijingDate,openSafetyPage,openPage,openHazards,showError } from './helpers'
const today=beijingDate(),month=ref(today.slice(0,7)),loading=ref(true),error=ref(''),config=ref({}),permissions=ref({}),days=ref([])
const legend=[{value:'no_inspection',label:'无巡检',class:'sm-tag--bad'},{value:'incomplete',label:'已巡检，日表待完成',class:'sm-tag--warn'},{value:'pending_signature',label:'内容已核对，待签认',class:'sm-tag--good'},{value:'recheck_required',label:'来源变化，待重新核对',class:'sm-tag--warn'}]
const leadingDays=computed(()=>(new Date(`${month.value}-01T00:00:00Z`).getUTCDay()+6)%7)
function stateLabel(state){return ({no_inspection:'无巡检',incomplete:'日表待完成',pending_signature:'待签认',recheck_required:'待重新核对',not_enabled:'未启用'})[state] || '待查询'}
function roleCount(role){return config.value.roles?.[role]?.length || 0}
function startInspection(){openPage('/pages/station-safety-inspection/form')}
async function loadDays(){const [year,number]=month.value.split('-').map(Number);const end=new Date(Date.UTC(year,number,0)).getUTCDate();const response=await listSafetyDaily({start_date:`${month.value}-01`,end_date:`${month.value}-${end}`});days.value=response.days || []}
async function load(){loading.value=true;error.value='';try{const response=await getSafetyConfig();config.value=response.config || {};permissions.value=response.permissions || {};await loadDays()}catch(err){error.value=err.message}finally{loading.value=false}}
async function changeMonth(step){const [year,number]=month.value.split('-').map(Number);month.value=new Date(Date.UTC(year,number-1+step,1)).toISOString().slice(0,7);try{await loadDays()}catch(err){showError(err)}}
onMounted(load)
defineExpose({refresh:load})
</script>
<style scoped>
.sm-home-overview { display:flex; align-items:center; justify-content:space-between; gap:20rpx; }.sm-home-overview .sm-actions { margin:0; }.sm-home-nav { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:20rpx; }.sm-nav-card { cursor:pointer; display:flex; flex-direction:column; gap:16rpx; }.sm-nav-card .sm-tag { align-self:flex-start; }.sm-nav-card .sm-link { margin-top:auto; }.sm-calendar-legend { display:flex; flex-wrap:wrap; gap:10rpx; margin-bottom:24rpx; }.sm-calendar { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:8rpx; }.sm-calendar-week { text-align:center; font-size:23rpx; padding:10rpx; color:#64748b; }.sm-calendar-day { min-height:130rpx; padding:12rpx; border:1rpx solid #e2e8f0; border-radius:12rpx; cursor:pointer; background:#f8fafc; }.sm-calendar-date,.sm-calendar-state,.sm-calendar-count { display:block; }.sm-calendar-date { font-size:27rpx; font-weight:800; }.sm-calendar-state { margin-top:10rpx; font-size:19rpx; line-height:1.5; }.sm-calendar-count { margin-top:8rpx; color:#64748b; font-size:18rpx; }.sm-calendar-day--pending_signature { background:#f0fdf4; border-color:#bbf7d0; }.sm-calendar-day--no_inspection { background:#fff1f2; border-color:#fecdd3; }.sm-calendar-day--incomplete,.sm-calendar-day--recheck_required { background:#fffbeb; border-color:#fde68a; }.sm-calendar-day--not_enabled { opacity:.5; }.sm-calendar-day--today { outline:2px solid #0e7490; }
@media(max-width:600px) { .sm-home-overview { flex-direction:column; align-items:stretch; }.sm-home-nav { grid-template-columns:1fr; }.sm-calendar-day { min-height:72px; padding:6px 3px; border-radius:6px; }.sm-calendar-date { font-size:15px; }.sm-calendar-state { font-size:10px; }.sm-calendar-count { font-size:9px; }.sm-calendar { gap:4px; }.sm-section-head { flex-wrap:wrap; } }
</style>

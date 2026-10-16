<template>
  <AppPage hide-nav hide-bottle-query :body-padding="false">
    <view class="sm-shell">
      <view class="sm-header sm-no-print">
        <button class="sm-back" aria-label="返回安全管理工作台" @click="back">‹</button>
        <view class="sm-heading"><text class="sm-eyebrow">企业安全管理 · 新拓能源</text><text class="sm-title">{{ title }}</text><text class="sm-subtitle">{{ subtitle }}</text></view>
        <view class="sm-header-action"><slot name="action" /></view>
      </view>
      <view class="sm-body"><slot /></view>
    </view>
  </AppPage>
</template>
<script setup>
import AppPage from '@/components/base/AppPage.vue'
import './safetyManagement.css'
const props = defineProps({ title: String, subtitle: { type: String, default: '现场事实一次记录，日、周、月台账关联引用' }, home: Boolean })
function back() { uni.navigateTo({ url: props.home ? '/pages/safety-inspection/home' : '/pages/safety-management/home' }) }
</script>

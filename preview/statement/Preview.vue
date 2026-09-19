<template><view><view class="preview-banner"><strong>本地交互预览 · 全部为模拟数据</strong><span>确认仅修改浏览器内存，刷新重置；未支持操作明确拒绝。</span><view class="preview-options"><button v-for="item in units" :key="item.id" @click="select(item.id)" :class="{active:id===item.id}">{{item.label}}</button><button @click="reset">重置模拟数据</button></view></view><CustomerStatementModule :key="version" :record-id="id" /></view></template>
<script setup>
import { ref } from 'vue'
import CustomerStatementModule from '@/components/domain/customer/statement/CustomerStatementModule.vue'
import { resetFixtures } from '/preview/statement/mock.mjs'
const units=[{id:'demo-kg',label:'按 kg · 23 笔销售'},{id:'demo-bottle',label:'按瓶 · 23 笔销售'},{id:'demo-m3',label:'按 m³ · 流量历史'}]
const id=ref('demo-kg'),version=ref(0)
function select(value){id.value=value}
function reset(){resetFixtures();version.value++}
</script>
<style scoped>.preview-banner{padding:12px 24px;background:#fff6da;color:#73510a;border-bottom:1px solid #efd083;display:flex;flex-wrap:wrap;align-items:center;gap:10px 24px;font-size:12px}.preview-options{display:flex;flex-wrap:wrap;gap:8px;max-width:100%}.preview-options button{font-size:12px;line-height:30px;padding:0 12px;margin:0;background:#fff}.preview-options button.active{background:#173b6c;color:white}</style>

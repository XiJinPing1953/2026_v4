<template>
  <view>
    <view v-for="(item,index) in modelValue" :key="index" class="sm-evidence-row">
      <text class="sm-tag">{{ typeLabels[item.type] || '引用' }}</text><text class="sm-evidence-value">{{ item.label || item.value }}</text>
      <button v-if="!readonly" class="sm-btn sm-btn--secondary sm-btn--small" @click="remove(index)">移除</button>
    </view>
    <view v-if="!readonly" class="sm-evidence-add">
      <picker :range="types" range-key="label" :value="typeIndex" @change="typeIndex = Number($event.detail.value)"><view class="sm-picker">{{ types[typeIndex].label }} ▾</view></picker>
      <input v-model="reference" class="sm-input" :placeholder="typeIndex ? '粘贴证据链接或云文件 ID' : '输入已有记录编号'" maxlength="1000" />
      <input v-model="label" class="sm-input" placeholder="证据说明（如充装记录、校验报告）" maxlength="100" />
      <view class="sm-row"><button class="sm-btn sm-btn--secondary sm-btn--small" :disabled="!reference.trim()" @click="add">添加引用</button><button class="sm-btn sm-btn--secondary sm-btn--small" :disabled="uploading" @click="upload">{{ uploading ? '照片上传中…' : '补充照片' }}</button></view>
    </view>
    <text v-if="!readonly" class="sm-help">已有记录、照片或报告可直接引用。正常、未开展项目不强制补拍。</text>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { chooseInspectionImages, uploadStationSafetyImage } from '@/services/stationSafetyInspectionMedia'
import { requestId, showError } from './helpers'
const props = defineProps({ modelValue: { type:Array, default:() => [] }, readonly:Boolean })
const emit = defineEmits(['update:modelValue','busy'])
const types = [{ type:'record', label:'记录编号' },{ type:'url', label:'证据链接' },{ type:'file', label:'已有云文件' }]
const typeLabels = { record:'记录',url:'链接',file:'附件' }
const typeIndex = ref(0), reference = ref(''), label = ref(''), uploading = ref(false)
function add() { if (!reference.value.trim()) return; const next = [...props.modelValue,{ type:types[typeIndex.value].type,value:reference.value.trim(),label:label.value.trim() }]; emit('update:modelValue', next); reference.value = ''; label.value = '' }
function remove(index) { emit('update:modelValue',props.modelValue.filter((_,i) => i !== index)) }
async function upload() { uploading.value = true; emit('busy',true); try { const paths = await chooseInspectionImages({ count:3,source:'album' }); const records = []; for (const [index,filePath] of paths.entries()) { const value = await uploadStationSafetyImage({ filePath,submissionId:requestId('safety_evidence'),scope:'supplement',index }); records.push({ type:'file',value,label:label.value.trim() || '现场照片' }) } emit('update:modelValue',[...props.modelValue,...records]) } catch(error) { if (!String(error?.errMsg || error?.message).includes('cancel')) showError(error) } finally { uploading.value=false; emit('busy',false) } }
</script>
<style scoped>
.sm-evidence-row { display:flex; align-items:center; gap:12rpx; padding:10rpx 0; }.sm-evidence-value { flex:1; min-width:0; overflow-wrap:anywhere; font-size:22rpx; }.sm-evidence-add { display:grid; grid-template-columns:1fr; gap:12rpx; margin-top:12rpx; }
</style>

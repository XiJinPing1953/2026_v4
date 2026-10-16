<template>
  <view class="workflow-check-fields">
    <template v-for="field in fields" :key="field.key">
      <view class="sm-field"><text class="sm-field-label">{{ field.label }}{{ field.required===false?'':' *' }}</text>
        <template v-if="field.choice"><WorkflowChoice :model-value="detailChoice(field.key)" :disabled="readonly" :options="checkOptions" @update:model-value="setDetail(field.key,$event)" /><input v-if="detailChoice(field.key)==='issue'" v-model="item.details[field.key]" class="sm-input workflow-detail-note" :disabled="readonly" placeholder="发现问题：具体情况" /></template>
        <textarea v-else-if="field.multiline" v-model="item.details[field.key]" class="sm-textarea" :disabled="readonly" :placeholder="field.placeholder || '填写或引用实际记录'" />
        <input v-else v-model="item.details[field.key]" class="sm-input" :disabled="readonly" :placeholder="field.placeholder || '填写或引用实际记录'" />
      </view>
    </template>
    <view class="sm-field"><text class="sm-field-label">本组检查结论</text><WorkflowChoice :model-value="item.result_code" :disabled="readonly" :options="resultOptions" @update:model-value="setResult" /><text v-if="!item.result_code" class="sm-help">尚未完成核实，保持待完成。</text></view>
    <label v-if="item.result_code==='abnormal' || showNote" class="sm-field"><text class="sm-field-label">{{ item.result_code==='abnormal'?'具体问题 *':'核对说明 / 本次变化' }}</text><textarea v-model="item.note" class="sm-textarea" :disabled="readonly" maxlength="2000" /></label>
    <button v-if="!showNote && item.result_code!=='abnormal'" class="sm-btn sm-btn--secondary sm-btn--small" @click="showNote=true">添加检查说明</button>
    <SafetyEvidenceEditor v-model="item.evidence" :readonly="readonly" @busy="$emit('busy',$event)" />
    <text v-if="item.hazard_ids?.length" class="sm-help">关联隐患：{{ item.hazard_ids.join('、') }}</text>
    <button v-if="!readonly && item.result_code==='abnormal' && !issueOpen" class="sm-btn sm-btn--secondary sm-btn--small" @click="issueOpen=true">立即登记问题 / 关联隐患</button>
    <SafetyIssueEditor v-if="issueOpen" :inspection-id="inspectionId" :date="date" :source-item-code="code" :category="category" :hazards="hazards" :initial-note="item.note" :evidence="item.evidence" @saved="issueSaved" @cancel="issueOpen=false" />
  </view>
</template>
<script setup>
import { ref,watch } from 'vue'
import WorkflowChoice from './WorkflowChoice.vue'
import SafetyEvidenceEditor from './SafetyEvidenceEditor.vue'
import SafetyIssueEditor from './SafetyIssueEditor.vue'
const props=defineProps({item:{type:Object,required:true},fields:{type:Array,default:()=>[]},readonly:Boolean,inspectionId:String,date:String,code:String,category:{type:Number,default:7},hazards:{type:Array,default:()=>[]}})
const emit=defineEmits(['busy','issue-saved'])
const showNote=ref(Boolean(props.item.note)),issueOpen=ref(false)
const checkOptions=[{value:'ok',label:'符合'},{value:'issue',label:'发现问题'},{value:'',label:'待核实'}]
const resultOptions=[{value:'normal',label:'已检查正常'},{value:'abnormal',label:'发现问题'},{value:'',label:'待核实'}]
function detailChoice(key){const value=props.item.details[key];return value==='符合'?'ok':String(value || '').startsWith('发现问题')?'issue':''}
function setDetail(key,value){props.item.details[key]=value==='ok'?'符合':value==='issue'?'发现问题：':'';if(value==='issue')props.item.result_code='abnormal';else if(!value)props.item.result_code=''}
function setResult(value){if(value==='normal' && props.fields.some(field=>field.choice && detailChoice(field.key)!=='ok')){uni.showToast({title:'请先逐项核实，发现问题不能记为正常',icon:'none'});return}props.item.result_code=value}
watch(()=>props.item.details?.content,value=>{if(props.code==='S11' && value && !props.item.note)props.item.note=value})
function issueSaved(result){if(result.issue_note && !props.item.note)props.item.note=result.issue_note;props.item.hazard_ids=[...new Set([...(props.item.hazard_ids || []),result.hazard_id])];issueOpen.value=false;emit('issue-saved',result)}
</script>
<style scoped>.workflow-detail-note{margin-top:12rpx}</style>

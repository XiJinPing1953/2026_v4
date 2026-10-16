<template><view class="sm-options"><button v-for="option in options" :key="String(option.value)" type="button" :disabled="disabled" :class="['sm-option',{'sm-option--active':modelValue===option.value && option.value!=='','sm-option--abnormal':option.value==='abnormal' || option.value==='no' && dangerNo}]" @click="$emit('update:modelValue',option.value)">{{ option.label }}</button></view></template>
<script setup>
defineProps({modelValue:{default:''},disabled:Boolean,dangerNo:Boolean,options:{type:Array,default:()=>[{value:'yes',label:'有'},{value:'no',label:'无'}]}})
defineEmits(['update:modelValue'])
</script>
<style scoped>button{margin:0;line-height:1.4}button::after{border:0}button[disabled]{opacity:.6}</style>

<template>
 <view class="bottle-field" :class="$attrs.class" :style="$attrs.style">
  <AppInput v-bind="$attrs" :model-value="modelValue" :type="keyboardType" :inputmode="native ? (textMode ? 'text' : 'numeric') : undefined" :confirm-hold="native && confirmHold" :disabled="disabled" :readonly="readonly"
   @update:modelValue="value => emit('update:modelValue', value)" @input="value => emit('input', value)" @focus="event => emit('focus', event)" @blur="event => emit('blur', event)" @confirm="confirm" />
  <AppButton v-if="native" class="bottle-mode" kind="ghost" :disabled="disabled || readonly || (textMode && hasLetters)" @click="letters = !textMode">{{ textMode ? '数字瓶号' : '带字母瓶号' }}</AppButton>
 </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import AppInput from '@/components/base/AppInput.vue'
import AppButton from '@/components/base/AppButton.vue'
import { isPdaAppMode } from '@/services/pda/entry'
defineOptions({ inheritAttrs: false })
const props = defineProps({ modelValue: { type: String, default: '' }, type: { type: String, default: 'text' }, disabled: Boolean, readonly: Boolean, confirmHold: Boolean })
const emit = defineEmits(['update:modelValue', 'input', 'focus', 'blur', 'confirm'])
const native = isPdaAppMode(), letters = ref(false)
const hasLetters = computed(() => /[^0-9]/.test(props.modelValue))
const textMode = computed(() => letters.value || hasLetters.value)
const keyboardType = computed(() => native ? (textMode.value ? 'text' : 'number') : props.type)
watch(() => props.modelValue, value => { if (!value) letters.value = false })
function confirm(event) {
 if (props.disabled || props.readonly) return
 // Use the final IME value, including the last digit, without numeric conversion.
 if (native && typeof event?.detail?.value === 'string') emit('update:modelValue', event.detail.value)
 emit('confirm', event)
}
</script>

<style scoped>
.bottle-field { min-width: 0; }
.bottle-mode { min-height: 48px; font-size: 16px; margin-left: auto; }
</style>

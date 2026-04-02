<template>
	<view class="field">
		<text v-if="label" class="field__label">{{ label }}</text>
		<view class="field__control" :class="{ 
			'field__control--disabled': disabled, 
			'field__control--readonly': readonly, 
			'field__control--focus': isFocused,
			'field__control--sm': size === 'sm'
		}">
			<view v-if="prefixIcon" class="field__icon">
				<AppIcon :name="prefixIcon" size="36rpx" class="icon-svg" />
			</view>
			<input
				class="field__input"
				:type="type"
				:password="type === 'password'"
				:value="modelValue"
				:name="name"
				:autocomplete="autocomplete"
				:placeholder="placeholder"
				:confirm-type="confirmType"
				:disabled="disabled || readonly"
				:focus="focus"
				@input="onInput"
				@confirm="$emit('confirm', $event)"
				@blur="handleBlur"
				@focus="handleFocus"
			/>
		</view>
	</view>
</template>

<script setup>
import { ref } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'

const props = defineProps({
	modelValue: { type: String, default: '' },
	label: { type: String, default: '' },
	placeholder: { type: String, default: '' },
	disabled: { type: Boolean, default: false },
	readonly: { type: Boolean, default: false },
	type: { type: String, default: 'text' },
	name: { type: String, default: '' },
	autocomplete: { type: String, default: '' },
	confirmType: { type: String, default: 'done' },
	prefixIcon: { type: String, default: '' },
	size: { type: String, default: 'md' },
	focus: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm', 'blur', 'focus', 'input'])

const isFocused = ref(false)

function onInput(e) {
	const val = e.detail.value
	emit('update:modelValue', val)
	emit('input', val)
}

function handleFocus(e) {
	if (props.readonly) return
	isFocused.value = true
	emit('focus', e)
}

function handleBlur(e) {
	isFocused.value = false
	emit('blur', e)
}
</script>

<style scoped>
.field {
	display: flex;
	flex-direction: column;
	gap: 8rpx;
}
.field__label {
	font-size: 24rpx;
	color: var(--crm-text-muted);
	font-weight: 400;
}
.field__control {
	border: 1rpx solid var(--crm-border);
	background: #fff;
	border-radius: var(--crm-radius-sm);
	padding: 0 24rpx;
	height: 80rpx;
	display: flex;
	align-items: center;
	transition: all 0.2s ease;
}
.field__control--sm {
	height: 64rpx;
	padding: 0 20rpx;
}
.field__control--sm .field__input {
	font-size: 26rpx;
}
.field__control--focus {
	border-color: var(--crm-primary);
	box-shadow: 0 0 0 2rpx var(--crm-primary);
}
.field__control--disabled {
	background: #f3f3f3;
	border-color: var(--crm-border);
	color: var(--crm-text-muted);
}
.field__control--readonly {
    background: #f9f9f9;
    border-color: var(--crm-border);
}
.field__icon {
	margin-right: 16rpx;
	color: var(--crm-text-muted);
	display: flex;
	align-items: center;
}
.field__control--focus .field__icon {
	color: var(--crm-primary);
}
.field__input {
	flex: 1;
	min-width: 0;
	width: 100%;
	font-size: 28rpx;
	color: var(--crm-text);
	height: 100%;
	border: none;
	outline: none;
	background: transparent;
	padding: 0;
	margin: 0;
	box-sizing: border-box;
	line-height: 1.4;
}
</style>

<template>
	<view class="field">
		<text v-if="label" class="field__label">{{ label }}</text>
		<view class="field__control" :class="{ 'field__control--disabled': disabled }">
			<input
				class="field__input"
				:type="type"
				:password="type === 'password'"
				:value="modelValue"
				:placeholder="placeholder"
				:disabled="disabled"
				@input="$emit('update:modelValue', $event.detail.value)"
			/>
		</view>
	</view>
</template>

<script setup>
defineProps({
	modelValue: { type: String, default: '' },
	label: { type: String, default: '' },
	placeholder: { type: String, default: '' },
	disabled: { type: Boolean, default: false },
	type: { type: String, default: 'text' }
})

defineEmits(['update:modelValue'])
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
}
.field__control {
	border: 1rpx solid var(--crm-border);
	border-radius: 14rpx;
	background: #fff;
	padding: 0 14rpx;
	height: 84rpx;
	display: flex;
	align-items: center;
}
.field__control--disabled {
	background: #f8fafc;
}
.field__input {
	flex: 1;
	font-size: 28rpx;
	color: var(--crm-text);
}
</style>

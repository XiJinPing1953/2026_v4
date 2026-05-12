<template>
	<view class="lookup-field">
		<AppInput
			:model-value="modelValue"
			:label="label"
			:placeholder="placeholder"
			:readonly="readonly"
			:disabled="disabled"
			:size="size"
			@update:modelValue="onUpdateModelValue"
			@input="onInput"
			@focus="onFocus"
			@blur="onBlur"
			@confirm="emit('confirm', $event)"
		/>
		<PdaSuggestList :visible="visible" :loading="loading" :items="items" :empty-text="emptyText" @select="onSelect" />
	</view>
</template>

<script setup>
import AppInput from '@/components/base/AppInput.vue'
import PdaSuggestList from '@/components/domain/pda/PdaSuggestList.vue'
import { usePdaSuggestions } from '@/composables/pda/usePdaSuggestions'

const props = defineProps({
	modelValue: { type: String, default: '' },
	label: { type: String, default: '' },
	placeholder: { type: String, default: '' },
	readonly: { type: Boolean, default: false },
	disabled: { type: Boolean, default: false },
	size: { type: String, default: 'md' },
	emptyText: { type: String, default: '未找到匹配项' },
	minLength: { type: Number, default: 1 },
	fetcher: { type: Function, default: null },
	mapItem: { type: Function, default: null }
})

const emit = defineEmits(['update:modelValue', 'input', 'focus', 'blur', 'confirm', 'select'])

const { items, loading, visible, handleBlur, handleFocus, handleInput, handleSelect } = usePdaSuggestions({
	minLength: props.minLength,
	debounceMs: 200,
	hideDelayMs: 150,
	fetcher: async (keyword) => {
		if (typeof props.fetcher !== 'function') return []
		return props.fetcher(keyword)
	},
	mapItem: (item) => {
		if (typeof props.mapItem === 'function') return props.mapItem(item)
		return item
	}
})

function onUpdateModelValue(value) {
	emit('update:modelValue', value)
}

function onInput(value) {
	emit('input', value)
	handleInput(value)
}

function onFocus(event) {
	emit('focus', event)
	handleFocus(props.modelValue)
}

function onBlur(event) {
	emit('blur', event)
	handleBlur()
}

function onSelect(item) {
	const picked = handleSelect(item)
	emit('select', picked?.raw || null)
}
</script>

<style scoped>
.lookup-field {
	display: flex;
	flex-direction: column;
}
</style>

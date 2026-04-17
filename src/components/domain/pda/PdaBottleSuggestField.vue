<template>
	<view class="suggest-field">
		<AppInput
			:model-value="modelValue"
			:label="label"
			:placeholder="placeholder"
			:type="type"
			:confirm-type="confirmType"
			:readonly="readonly"
			:disabled="disabled"
			:size="size"
			@update:modelValue="onUpdateModelValue"
			@input="onInput"
			@focus="onFocus"
			@blur="onBlur"
			@confirm="emit('confirm', $event)"
		/>
		<PdaSuggestList
			:visible="visible"
			:loading="loading"
			:items="items"
			empty-text="未找到匹配钢瓶"
			@select="onSelect"
		/>
	</view>
</template>

<script setup>
import AppInput from '@/components/base/AppInput.vue'
import PdaSuggestList from '@/components/domain/pda/PdaSuggestList.vue'
import { usePdaSuggestions } from '@/composables/pda/usePdaSuggestions'
import { formatBottleSuggestionSub, normalizeBottleNo, searchBottleSuggestions } from '@/composables/useBottleSuggestions'

const props = defineProps({
	modelValue: { type: String, default: '' },
	label: { type: String, default: '' },
	placeholder: { type: String, default: '' },
	type: { type: String, default: 'text' },
	confirmType: { type: String, default: 'done' },
	readonly: { type: Boolean, default: false },
	disabled: { type: Boolean, default: false },
	size: { type: String, default: 'md' }
})

const emit = defineEmits(['update:modelValue', 'input', 'focus', 'blur', 'confirm', 'select'])

const { items, loading, visible, handleBlur, handleFocus, handleInput, handleSelect } = usePdaSuggestions({
	minLength: 1,
	debounceMs: 200,
	hideDelayMs: 150,
	fetcher: async (keyword) => searchBottleSuggestions(keyword, { limit: 6 }),
	mapItem: (item) => ({
		key: item?._id || normalizeBottleNo(item?.bottle_no),
		title: normalizeBottleNo(item?.bottle_no) || '-',
		subtitle: formatBottleSuggestionSub(item),
		raw: item
	})
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
	const bottleNo = normalizeBottleNo(picked?.raw?.bottle_no || picked?.title)
	emit('update:modelValue', bottleNo)
	emit('input', bottleNo)
	emit('select', picked?.raw || null)
}
</script>

<style scoped>
.suggest-field {
	display: flex;
	flex-direction: column;
}
</style>

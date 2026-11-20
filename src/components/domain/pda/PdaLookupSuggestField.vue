<template>
	<view class="lookup-field">
		<view :class="{ 'lookup-entry': confirmSearch }">
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
				:confirm-type="confirmSearch ? 'search' : 'done'"
				@confirm="onConfirm"
			/>
			<AppButton v-if="confirmSearch" kind="outline" :disabled="disabled || readonly || !modelValue.trim()" @click="onConfirm()">查找</AppButton>
		</view>
		<PdaSuggestList :select-label="confirmSearch ? '确定客户' : ''" :visible="visible" :loading="loading" :items="items" :empty-text="emptyText" @select="onSelect" />
	</view>
</template>

<script setup>
import { watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import AppInput from '@/components/base/AppInput.vue'
import PdaSuggestList from '@/components/domain/pda/PdaSuggestList.vue'
import { usePdaSuggestions } from '@/composables/pda/usePdaSuggestions'

const props = defineProps({
	modelValue: { type: String, default: '' },
	confirmSearch: Boolean,
	selectedId: { type: String, default: '' },
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

const { items, loading, visible, handleBlur, handleFocus, handleInput, handleSelect, clear } = usePdaSuggestions({
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

watch(() => props.selectedId, id => {
	if (id) clear()
})

function onConfirm(event) {
	if (props.disabled || props.readonly) return
	if (!props.confirmSearch) { emit('confirm', event); return }
	const value = event?.detail?.value ?? props.modelValue
	if (value !== props.modelValue) emit('update:modelValue', value)
	if (!value.trim()) { clear(); return }
	clear()
	handleFocus(value)
	uni.hideKeyboard()
}

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
	// A driver can dismiss the handwriting pad before choosing a customer.
	if (!props.confirmSearch) handleBlur()
}

function onSelect(item) {
	if (props.disabled || props.readonly || (props.confirmSearch && !items.value.includes(item))) return
	const picked = handleSelect(item)
	if (props.confirmSearch) uni.hideKeyboard()
	emit('select', picked?.raw || null)
}
</script>

<style scoped>
.lookup-field {
	display: flex;
	flex-direction: column;
}
.lookup-entry {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 8px;
	align-items: end;
}
</style>

<template>
	<view v-if="modelValue" class="app-modal-backdrop" @click.self="close">
		<view ref="dialog" class="app-modal" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
			<view class="app-modal__heading"><text class="app-modal__title">{{ title }}</text><AppButton size="sm" kind="ghost" aria-label="关闭弹窗" tabindex="0" @click="close">关闭</AppButton></view>
			<view class="app-modal__body"><slot /></view>
		</view>
	</view>
</template>
<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppButton from './AppButton.vue'
const props = defineProps({ modelValue: { type: Boolean, default: false }, title: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const dialog = ref(null)
let previousFocus = null
let scrollPositions = []
const element = () => dialog.value?.$el || dialog.value
function focusWithoutScroll(target) { target?.focus?.({ preventScroll: true }) }
function rememberScroll() {
	const containers = new Set([document.scrollingElement, ...document.querySelectorAll('uni-page-body, uni-page-wrapper, uni-page, .uni-page-wrapper, .uni-page-body, uni-scroll-view, .uni-scroll-view')])
	for (let parent = previousFocus; parent; parent = parent.parentElement) containers.add(parent)
	scrollPositions = [...containers].filter(Boolean).map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }))
}
function restoreScroll() { for (const { node, top, left } of scrollPositions) { node.scrollTop = top; node.scrollLeft = left } }
function close() { emit('update:modelValue', false) }
function onKeydown(event) {
	if (!props.modelValue) return
	if (event.key === 'Escape') { event.preventDefault(); close(); return }
	if (event.key !== 'Tab') return
	const target = element()
	const items = Array.from(target?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []).filter(item => item.getAttribute('aria-hidden') !== 'true' && item.getClientRects().length > 0)
	const first = items[0], last = items[items.length - 1]
	if (!first) { event.preventDefault(); focusWithoutScroll(target); return }
	if (event.shiftKey && (document.activeElement === first || !target.contains(document.activeElement))) { event.preventDefault(); focusWithoutScroll(last) }
	else if (!event.shiftKey && (document.activeElement === last || !target.contains(document.activeElement))) { event.preventDefault(); focusWithoutScroll(first) }
}
function cleanup() {
	if (typeof document === 'undefined') return
	document.removeEventListener('keydown', onKeydown, true)
	if (previousFocus?.isConnected) focusWithoutScroll(previousFocus)
	restoreScroll()
	previousFocus = null
	scrollPositions = []
}
watch(() => props.modelValue, async open => {
	if (typeof document === 'undefined') return
	if (!open) { cleanup(); return }
	previousFocus = document.activeElement
	rememberScroll()
	document.addEventListener('keydown', onKeydown, true)
	await nextTick()
	if (props.modelValue) { focusWithoutScroll(element()); restoreScroll() }
}, { immediate: true })
onBeforeUnmount(cleanup)
</script>
<style scoped>
.app-modal-backdrop { position:fixed; inset:0; z-index:1100; display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; background:rgba(21,32,48,.42); }
.app-modal { width:560px; max-width:100%; max-height:calc(100dvh - 48px); display:flex; flex-direction:column; background:#fff; border-radius:12px; box-shadow:0 20px 70px #15203030; outline:none; }
.app-modal__heading { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:18px 22px; border-bottom:1px solid var(--crm-border); flex:none; }
.app-modal__title { font-size:17px; font-weight:600; color:var(--crm-text); }
.app-modal__heading :deep(.btn) { height:32px; min-height:32px; padding:0 10px; font-size:13px; }
.app-modal__body { overflow:auto; padding:22px; min-height:0; }
@media(max-width:600px) { .app-modal-backdrop { padding:14px; } .app-modal { max-height:calc(100dvh - 28px); } .app-modal__heading { padding:14px 16px; } .app-modal__body { padding:16px; } .app-modal__heading :deep(.btn) { min-height:44px; } }
</style>

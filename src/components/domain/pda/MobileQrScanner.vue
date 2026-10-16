<template>
	<view v-if="open" class="mobile-scanner" role="dialog" aria-modal="true" :aria-label="`扫码：${label}`">
		<view class="mobile-scanner__toolbar">
			<text class="mobile-scanner__title">扫描{{ label }}</text>
			<AppButton kind="neutral" size="sm" @click="close">关闭</AppButton>
		</view>
		<view :id="hostId" class="mobile-scanner__video" />
		<text class="mobile-scanner__hint" aria-live="polite">{{ error || scanHint }}</text>
		<AppButton v-if="error || canRetry" kind="neutral" @click="start">重新打开摄像头</AppButton>
	</view>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import { createCameraScannerLifecycle } from '@/services/pda/cameraScan'
// #ifdef H5
// This distribution bundles its worker. uni-app otherwise emits bare "..-node_modules"
// dynamic import paths which fail in the production browser (including software decoding).
import QrScanner from 'qr-scanner/qr-scanner.legacy.min.js'
// Static import: this public factory embeds the software worker in a Blob;
// it does not depend on a production-time dynamic import or an external CDN.
import { createWorker } from 'qr-scanner/qr-scanner-worker.min.js'
// #endif

const props = defineProps({ open: Boolean, label: { type: String, default: '二维码' } })
const emit = defineEmits(['result', 'close'])
const hostId = `sale-camera-${Math.random().toString(36).slice(2)}`
const error = ref('')
const scanHint = ref('正在打开摄像头…')
const canRetry = ref(false)
let renderGeneration = 0
const camera = createCameraScannerLifecycle({
	loadScanner: async () => {
		// #ifdef H5
		return QrScanner
		// #endif
		throw new Error('Camera scanning requires H5')
	},
	createSoftwareEngine: () => {
		// #ifdef H5
		return createWorker()
		// #endif
		throw new Error('Camera scanning requires H5')
	},
	onStatus: (status) => {
		canRetry.value = ['searching', 'decoder-error', 'software-error'].includes(status)
		scanHint.value = ({
			starting: '正在打开摄像头…',
			scanning: '将二维码完整放入画面，保持清晰，识别后自动返回。',
			searching: '尚未识别。请对准二维码，调整距离并避开反光；也可关闭后手工搜索。',
			'decoder-error': '浏览器识别暂不可用，正在尝试兼容识别；可重开摄像头。',
			'software-error': '兼容识别暂不可用，请重开摄像头；也可关闭后手工搜索。'
		})[status] || ''
	},
	onResult: (rawText) => emit('result', rawText),
	onError: (err) => {
		const message = String(err?.message || err || '')
		error.value = /permission|denied|NotAllowed/i.test(message)
			? '摄像头权限未开放，请在浏览器设置中允许本站使用摄像头后重试。'
			: '摄像头无法启动，请允许本站使用摄像头，并检查是否被其他应用占用；也可关闭后手工搜索。'
	}
})

async function start() {
	const generation = ++renderGeneration
	error.value = ''
	camera.close()
	await nextTick()
	if (!props.open || generation !== renderGeneration || typeof document === 'undefined') return
	const host = document.getElementById(hostId)
	if (!host) return
	host.replaceChildren()
	const video = document.createElement('video')
	video.setAttribute('playsinline', '')
	video.muted = true
	video.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain'
	host.appendChild(video)
	await camera.open(video)
}

function stop() {
	renderGeneration += 1
	camera.close()
}

function close() {
	stop()
	emit('close')
}

watch(() => props.open, (open) => open ? start() : stop(), { immediate: true })
onBeforeUnmount(stop)
</script>

<style scoped>
.mobile-scanner { position:fixed; inset:0; z-index:3000; display:flex; flex-direction:column; gap:16px; padding:calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom)); background:#0f172a; color:white; box-sizing:border-box; }
.mobile-scanner__toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.mobile-scanner__title { font-size:20px; font-weight:700; }
.mobile-scanner__video { flex:1; min-height:160px; overflow:hidden; border-radius:12px; background:#020617; }
.mobile-scanner__hint { font-size:16px; line-height:1.6; }
</style>

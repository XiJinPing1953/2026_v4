<template>
	<view class="signature">
		<canvas
			:id="canvasId"
			class="signature__canvas"
			:canvas-id="canvasId"
			:disable-scroll="true"
			@touchstart.stop.prevent="onStart"
			@touchmove.stop.prevent="onMove"
			@touchend.stop.prevent="onEnd"
			@touchcancel.stop.prevent="onEnd"
		/>
		<text v-if="!hasInk" class="signature__hint">请责任人在此手写签名</text>
		<view class="signature__tools">
			<text :class="['signature__state', { 'signature__state--ok': hasInk }]">
				{{ hasInk ? '已完成手写签名' : '签名必填' }}
			</text>
			<button class="signature__clear" type="button" @click="clear">清空重签</button>
		</view>
	</view>
</template>

<script setup>
import { getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits(['change'])
const proxy = getCurrentInstance()?.proxy
const canvasId = `station-safety-signature-${Math.random().toString(36).slice(2, 10)}`
const hasInk = ref(false)
const rect = ref({ left: 0, top: 0, width: 0, height: 0 })
let context = null
let drawing = false
let lastPoint = null
let activeStroke = null
const strokes = []

function refreshRect() {
	uni.createSelectorQuery().in(proxy).select(`#${canvasId}`).boundingClientRect((value) => {
		if (!value) return
		const changed = Math.abs(Number(rect.value.width || 0) - Number(value.width || 0)) > 1 || Math.abs(Number(rect.value.height || 0) - Number(value.height || 0)) > 1
		rect.value = value
		if (changed && strokes.length) { context = null; setTimeout(redraw, 30) }
	}).exec()
}

function pointFromEvent(event) {
	const touch = event?.touches?.[0] || event?.changedTouches?.[0] || {}
	const directX = Number(touch.x)
	const directY = Number(touch.y)
	if (Number.isFinite(directX) && Number.isFinite(directY)) return { x: directX, y: directY }
	const clientX = Number(touch.clientX ?? touch.pageX)
	const clientY = Number(touch.clientY ?? touch.pageY)
	return {
		x: Number.isFinite(clientX) ? clientX - Number(rect.value.left || 0) : 0,
		y: Number.isFinite(clientY) ? clientY - Number(rect.value.top || 0) : 0
	}
}

function ensureContext() {
	if (context) return context
	context = uni.createCanvasContext(canvasId, proxy)
	context.setLineWidth(3)
	context.setLineCap('round')
	context.setLineJoin('round')
	context.setStrokeStyle('#102a43')
	return context
}

function normalizePoint(point) {
	return {
		x: Math.min(Math.max(point.x / Math.max(Number(rect.value.width || 0), 1), 0), 1),
		y: Math.min(Math.max(point.y / Math.max(Number(rect.value.height || 0), 1), 0), 1)
	}
}

function denormalizePoint(point) {
	return { x: point.x * Math.max(Number(rect.value.width || 0), 1), y: point.y * Math.max(Number(rect.value.height || 0), 1) }
}

function redraw() {
	const ctx = ensureContext()
	ctx.clearRect(0, 0, Math.max(rect.value.width, 1000), Math.max(rect.value.height, 600))
	for (const stroke of strokes) {
		if (!Array.isArray(stroke) || stroke.length < 2) continue
		const start = denormalizePoint(stroke[0])
		ctx.beginPath()
		ctx.moveTo(start.x, start.y)
		for (let index = 1; index < stroke.length; index += 1) {
			const point = denormalizePoint(stroke[index])
			ctx.lineTo(point.x, point.y)
		}
		ctx.stroke()
	}
	ctx.draw()
}

function onStart(event) {
	drawing = true
	lastPoint = pointFromEvent(event)
	activeStroke = [normalizePoint(lastPoint)]
	strokes.push(activeStroke)
}

function onMove(event) {
	if (!drawing || !lastPoint) return
	const next = pointFromEvent(event)
	const ctx = ensureContext()
	ctx.beginPath(); ctx.moveTo(lastPoint.x, lastPoint.y); ctx.lineTo(next.x, next.y); ctx.stroke(); ctx.draw(true)
	activeStroke?.push(normalizePoint(next))
	lastPoint = next
	if (!hasInk.value) { hasInk.value = true; emit('change', true) }
}

function onEnd() {
	drawing = false
	lastPoint = null
	if (Array.isArray(activeStroke) && activeStroke.length < 2) strokes.pop()
	activeStroke = null
}

function clear() {
	const ctx = ensureContext()
	ctx.clearRect(0, 0, Math.max(rect.value.width, 1000), Math.max(rect.value.height, 600)); ctx.draw()
	strokes.splice(0, strokes.length)
	activeStroke = null
	hasInk.value = false
	emit('change', false)
}

function exportFile() {
	if (!hasInk.value) return Promise.reject(new Error('签名为空'))
	return new Promise((resolve, reject) => {
		uni.canvasToTempFilePath({
			canvasId,
			fileType: 'png',
			quality: 1,
			destWidth: 1400,
			destHeight: 560,
			success: (res) => resolve(res.tempFilePath),
			fail: reject
		}, proxy)
	})
}

onMounted(() => {
	setTimeout(refreshRect, 50)
	if (typeof window !== 'undefined') window.addEventListener('resize', refreshRect)
})
onBeforeUnmount(() => {
	if (typeof window !== 'undefined') window.removeEventListener('resize', refreshRect)
})

defineExpose({ clear, exportFile, hasInk, refresh: refreshRect })
</script>

<style scoped>
.signature { position: relative; }
.signature__canvas { width: 100%; height: 260rpx; box-sizing: border-box; background: #fff; border: 2rpx dashed #9fb3c8; border-radius: 18rpx; touch-action: none; }
:deep(.signature__canvas .uni-canvas-canvas) { touch-action: none; }
.signature__hint { position: absolute; top: 102rpx; left: 0; right: 0; text-align: center; color: #9aa9b8; font-size: 24rpx; pointer-events: none; }
.signature__tools { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; }
.signature__state { color: #c2410c; font-size: 22rpx; }
.signature__state--ok { color: #047857; }
.signature__clear { margin: 0; padding: 0 8rpx; color: #64748b; background: transparent; font-size: 23rpx; line-height: 1.8; }
.signature__clear::after { border: 0; }
</style>

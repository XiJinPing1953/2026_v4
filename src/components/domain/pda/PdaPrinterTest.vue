<template>
	<view class="printer-test">
		<AppButton kind="outline" @click="toggle">{{ opened ? '收起打印测试' : '打印测试' }}</AppButton>
		<view v-if="opened" class="printer-test__body">
			<text>60×40 mm 横版标签 · 仅测试</text>
			<text>测试瓶 TEST001　皮重 110.0 kg</text>
			<text>毛重 185.5 kg　净重 75.5 kg</text>
			<text>新拓能源及以上四项同时放入二维码。测试标签不要贴到实瓶。</text>
			<text role="status">{{ message }}</text>
			<AppButton :disabled="busy || attempted" @click="connect">选择并连接打印机</AppButton>
			<AppButton :disabled="!connected || sent || busy" @click="print">打印一张测试标签</AppButton>
		</view>
	</view>
</template>
<script setup>
import { onBeforeUnmount, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import { ensurePdaBleRuntimePermission } from '@/services/pda/bleScale'
import { createPrinterTestSession } from '@/services/pda/printerTest'
import { selectPairedPrinter, rememberPrinter } from '@/services/pda/printerSelection'
const opened = ref(false), busy = ref(false), attempted = ref(false), connected = ref(false), sent = ref(false)
const message = ref('先在系统蓝牙中配对打印机，再点击选择并连接。')
let session = null, generation = 0
function close() {
	generation++; session?.close(); session = null
	opened.value = false; connected.value = false; busy.value = false
}
function toggle() {
	if (opened.value) return close()
	opened.value = true; attempted.value = false; sent.value = false
	message.value = '先在系统蓝牙中配对打印机，再点击选择并连接。'
}
async function connect() {
	if (!opened.value || busy.value || attempted.value) return
	const current = ++generation
	busy.value = true
	try {
		const permission = await ensurePdaBleRuntimePermission()
		if (current !== generation) return
		if (permission.code !== 0) throw new Error(permission.msg || '请允许蓝牙权限')
		const device = await selectPairedPrinter({ android: plus.android, ui: uni, valid: () => current === generation && opened.value })
		if (current !== generation || !opened.value) return
		if (!device) throw new Error('已取消选择打印机')
		session = createPrinterTestSession(uni.requireNativePlugin('TH-PlatformBLE'), state => {
			if (current !== generation) return
			connected.value = state.connected; message.value = state.connected && !sent.value ? '已连接 ' + device.name : state.message
			if (state.connected && !sent.value) rememberPrinter(uni, device)
		})
		attempted.value = true; message.value = '正在连接打印机'
		session.connect(device.address)
	} catch (error) {
		if (current === generation) { session?.close(); session = null; connected.value = false; message.value = error.message || '连接失败，请收起后重试' }
	} finally { if (current === generation) busy.value = false }
}
async function print() {
	if (!opened.value || !connected.value || sent.value || busy.value) return
	sent.value = true
	const version = generation
	try { await session.print() } catch (error) { if (version !== generation) return; message.value = `${error.message || '发送异常'}。请先查看是否出纸，避免重复打印。` }
}
onBeforeUnmount(close)
defineExpose({ close })
</script>
<style scoped>
.printer-test { margin-top: 16px; }
.printer-test__body { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; font-size: 16px; line-height: 1.5; }
.printer-test :deep(.btn) { min-height: 48px; font-size: 16px; }
</style>

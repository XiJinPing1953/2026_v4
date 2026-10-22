<template>
	<view class="printer-test">
		<AppButton kind="outline" @click="toggle">{{ opened ? '收起打印测试' : '打印测试' }}</AppButton>
		<view v-if="opened" class="printer-test__body">
			<text>HL300 · 50×80 mm 竖版 · 仅测试</text>
			<text>测试瓶 TEST001　皮重 110.0 kg</text>
			<text>毛重 185.5 kg　净重 75.5 kg</text>
			<text>新拓能源及以上四项同时放入二维码。测试标签不要贴到实瓶。</text>
			<text role="status">{{ message }}</text>
			<AppButton :disabled="busy || attempted" @click="connect">连接 HL30-AA21</AppButton>
			<AppButton :disabled="!connected || sent || busy" @click="print">打印一张测试标签</AppButton>
		</view>
	</view>
</template>
<script setup>
import { onBeforeUnmount, ref } from 'vue'
import AppButton from '@/components/base/AppButton.vue'
import { ensurePdaBleRuntimePermission } from '@/services/pda/bleScale'
import { createPrinterTestSession, getPairedTestPrinters } from '@/services/pda/printerTest'
const opened = ref(false), busy = ref(false), attempted = ref(false), connected = ref(false), sent = ref(false)
const message = ref('先在系统蓝牙中配对 HL30-AA21，再点击连接。')
let session = null, generation = 0
function close() {
	generation++; session?.close(); session = null
	opened.value = false; connected.value = false; busy.value = false
}
function toggle() {
	if (opened.value) return close()
	opened.value = true; attempted.value = false; sent.value = false
	message.value = '先在系统蓝牙中配对 HL30-AA21，再点击连接。'
}
async function connect() {
	if (!opened.value || busy.value || attempted.value) return
	const current = ++generation
	busy.value = true
	try {
		const permission = await ensurePdaBleRuntimePermission()
		if (current !== generation) return
		if (permission.code !== 0) throw new Error(permission.msg || '请允许蓝牙权限')
		const devices = getPairedTestPrinters(plus.android)
		if (devices.length !== 1) throw new Error('未找到唯一的已配对 HL30-AA21，请到系统蓝牙核对')
		session = createPrinterTestSession(uni.requireNativePlugin('TH-PlatformBLE'), state => {
			if (current !== generation) return
			connected.value = state.connected; message.value = state.message
		})
		attempted.value = true; message.value = '正在连接打印机'
		session.connect(devices[0].address)
	} catch (error) {
		if (current === generation) { session?.close(); session = null; connected.value = false; message.value = error.message || '连接失败，请收起后重试' }
	} finally { if (current === generation) busy.value = false }
}
function print() {
	if (!opened.value || !connected.value || sent.value || busy.value) return
	sent.value = true
	try { session.print() } catch (error) { message.value = `${error.message || '发送异常'}。请先查看是否出纸，避免重复打印。` }
}
onBeforeUnmount(close)
defineExpose({ close })
</script>
<style scoped>
.printer-test { margin-top: 16px; }
.printer-test__body { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; font-size: 16px; line-height: 1.5; }
.printer-test :deep(.btn) { min-height: 48px; font-size: 16px; }
</style>

<template>
	<view>
		<view class="preview-banner">
			<view class="preview-copy"><strong>本地出纳预览 · 全部为模拟数据</strong><span>{{ notice }}</span></view>
			<view class="preview-options">
				<button @click="armUploadFailure">下次上传模拟失败</button>
				<button @click="armSaveTimeout">下次保存模拟回执超时</button>
				<button @click="reset">重置模拟数据</button>
			</view>
		</view>
		<CashierReceiptIntakeView :key="version" />
	</view>
</template>

<script setup>
import { ref } from 'vue'
import CashierReceiptIntakeView from '@/components/domain/customer/CashierReceiptIntakeView.vue'
import {
	armCashierSaveTimeout,
	armCashierUploadFailure,
	consumeCashierUploadFailure,
	resetFixtures
} from '/preview/statement/mock.mjs'

const version = ref(0)
const notice = ref('仅修改浏览器内存；列表含 72 条模拟登记，可验证每页 20 条游标分页。')

const previewCloud = globalThis.uniCloud
if (previewCloud) {
	previewCloud.uploadFile = async ({ cloudPath = '' } = {}) => {
		if (consumeCashierUploadFailure()) throw new Error('本地模拟上传失败')
		return { fileID: `cloud://demo-space/${String(cloudPath).replace(/^\/+/, '')}` }
	}
	previewCloud.getTempFileURL = async ({ fileList = [] } = {}) => ({
		fileList: fileList.map((fileID) => ({ fileID, code: 0, tempFileURL: fileID }))
	})
}

function armUploadFailure() {
	armCashierUploadFailure()
	notice.value = '已设定：下一次凭证上传会失败一次；表单和操作号应保留。'
}

function armSaveTimeout() {
	armCashierSaveTimeout()
	notice.value = '已设定：下一次保存会先写入模拟内存，再丢失回执；页面应按操作号恢复。'
}

function reset() {
	resetFixtures()
	version.value += 1
	notice.value = '模拟数据已重置；未发生任何云端写入。'
}
</script>

<style scoped>
.preview-banner { padding: 12px 24px; background: #eaf4ff; color: #173b6c; border-bottom: 1px solid #a9caee; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 24px; font-size: 12px; }
.preview-copy { display: flex; flex-direction: column; gap: 4px; }
.preview-options { display: flex; flex-wrap: wrap; gap: 8px; max-width: 100%; }
.preview-options button { font-size: 12px; line-height: 30px; padding: 0 12px; margin: 0; background: #fff; }
@media (max-width: 640px) { .preview-banner, .preview-options { align-items: stretch; flex-direction: column; } }
</style>

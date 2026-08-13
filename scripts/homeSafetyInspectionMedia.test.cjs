'use strict'

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const sourcePath = path.resolve(__dirname, '../src/services/homeSafetyInspectionMedia.js')

function loadMediaService(uniCloud) {
	const source = fs
		.readFileSync(sourcePath, 'utf8')
		.replace(/export\s+async\s+function\s+/g, 'async function ')
		.replace(/export\s+function\s+/g, 'function ')
	return Function('uniCloud', `${source}\nreturn { resolveInspectionFileUrls }`)(uniCloud)
}

function cloudId(index) {
	return `cloud://test-space/station-safety/photo-${index}.jpg`
}

test('超过50张巡检图片时分批获取临时链接', async () => {
	const calls = []
	const service = loadMediaService({
		async getTempFileURL({ fileList }) {
			calls.push(fileList.slice())
			if (fileList.length > 50) throw new Error('fileList数组长度不能超过50')
			return {
				fileList: fileList.map((fileID) => ({
					fileID,
					tempFileURL: `https://files.example/${encodeURIComponent(fileID)}`
				}))
			}
		}
	})
	const fileIds = Array.from({ length: 61 }, (_, index) => cloudId(index + 1))
	const result = await service.resolveInspectionFileUrls(fileIds)
	assert.deepEqual(calls.map((batch) => batch.length), [50, 11])
	assert.equal(Object.keys(result).length, 61)
	assert.match(result[fileIds[0]], /^https:\/\//)
	assert.match(result[fileIds[60]], /^https:\/\//)
})

test('单批失败不影响后续批次解析且重复文件只请求一次', async () => {
	const calls = []
	const service = loadMediaService({
		async getTempFileURL({ fileList }) {
			calls.push(fileList.slice())
			if (calls.length === 1) throw new Error('temporary failure')
			return { fileList: fileList.map((fileID) => ({ fileID, tempFileURL: `https://files.example/${fileID}` })) }
		}
	})
	const unique = Array.from({ length: 51 }, (_, index) => cloudId(index + 1))
	const result = await service.resolveInspectionFileUrls([...unique, unique[0], 'invalid'])
	assert.deepEqual(calls.map((batch) => batch.length), [50, 1])
	assert.equal(result[unique[0]], unique[0])
	assert.match(result[unique[50]], /^https:\/\//)
})

test('详情页可按20张逐批显示并复用短期缓存', async () => {
	const calls = []
	const rendered = []
	const service = loadMediaService({
		async getTempFileURL({ fileList }) {
			calls.push(fileList.slice())
			return {
				fileList: fileList.map((fileID) => ({
					fileID,
					tempFileURL: `https://files.example/${encodeURIComponent(fileID)}`
				}))
			}
		}
	})
	const fileIds = Array.from({ length: 61 }, (_, index) => cloudId(index + 1))
	const result = await service.resolveInspectionFileUrls(fileIds, {
		batchSize: 20,
		onBatchResolved: (batch) => rendered.push(Object.keys(batch).length)
	})
	assert.deepEqual(calls.map((batch) => batch.length), [20, 20, 20, 1])
	assert.deepEqual(rendered, [20, 20, 20, 1])
	assert.equal(Object.keys(result).length, 61)

	const cachedRendered = []
	await service.resolveInspectionFileUrls(fileIds, {
		batchSize: 20,
		onBatchResolved: (batch, meta) => cachedRendered.push([Object.keys(batch).length, meta.source])
	})
	assert.equal(calls.length, 4)
	assert.deepEqual(cachedRendered, [[61, 'cache']])
})

test('厂站详情切屏不重复刷新并按20张渐进懒加载', () => {
	const page = fs.readFileSync(
		path.resolve(__dirname, '../src/pages/station-safety-inspection/detail.vue'),
		'utf8'
	)
	const detail = fs.readFileSync(
		path.resolve(
			__dirname,
			'../src/components/domain/stationSafetyInspection/StationSafetyInspectionDetailView.vue'
		),
		'utf8'
	)
	assert.doesNotMatch(page, /\bonShow\b/)
	assert.match(detail, /batchSize:\s*20/)
	assert.match(detail, /onBatchResolved:/)
	assert.match(detail, /\blazy-load\b/)
})

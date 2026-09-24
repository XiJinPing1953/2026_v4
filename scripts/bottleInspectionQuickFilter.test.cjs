'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { ref, reactive, computed, watch } = require('vue')

function scriptAt(path) {
	return fs.readFileSync(path, 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*\n/gm, '')
}

function makeInspectionView(initialInspectionDueModule = '', initialInspectionDueState = '') {
	const requests = []
	const context = {
		defineProps: () => ({ initialInspectionDueModule, initialInspectionDueState }),
		ref, reactive, computed, watch,
		onMounted: (fn) => { context.mount = fn },
		useAuthGuard: () => ({ canPageAction: () => true }),
		loadInspectionCandidates: async (_search, params) => {
			requests.push(params)
			return [{ _id: 'b2', bottle_no: '2' }, { _id: 'b1', bottle_no: '1' }]
		},
		searchBottlesV1: () => {},
		batchUpdateInspectionV2: () => {},
		uni: { showToast: () => {} },
		Date, Intl, JSON, Set, Map, Promise
	}
	vm.runInNewContext(scriptAt('src/components/domain/bottle/BottleInspectionView.vue') + '\nthis.view = { filters, selectedModules, selectedBottleIds, excludedBottleIds, selectionMode, inspectionDate, pager, onQuickDueFilter, isQuickFilterActive, selectAllFiltered, buildRequest, onModuleChange, onInspectionDueStateChange }', context)
	return { context, requests, view: context.view }
}

test('quick actions clear old scope, filter active bottles and preselect the matching project', async () => {
	const { view, requests } = makeInspectionView()
	view.filters.keyword = 'old keyword'
	view.filters.statusIndex = 2
	view.selectedBottleIds.value = ['old-id']
	view.onQuickDueFilter('gauge')
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(view.filters.keyword, '')
	assert.equal(view.filters.statusIndex, 0)
	assert.deepEqual(Array.from(view.selectedBottleIds.value), [])
	assert.deepEqual(Array.from(view.selectedModules.value), ['gauge'])
	assert.equal(requests.at(-1).inspection_due_module, 'gauge')
	assert.equal(requests.at(-1).inspection_due_state, 'overdue_or_due_60d')
	assert.equal(requests.at(-1).is_active, true)
	assert.equal(view.isQuickFilterActive('gauge'), true)
	assert.equal(view.pager.total, 2)

	view.inspectionDate.value = '2026-09-24'
	view.selectAllFiltered()
	const preview = view.buildRequest(true)
	assert.equal(preview.scope_mode, 'filter')
	assert.equal(preview.selector.inspection_due_module, 'gauge')
	assert.equal(preview.selector.inspection_due_state, 'overdue_or_due_60d')
	view.filters.keyword = 'new keyword'
	await Promise.resolve()
	assert.equal(view.selectionMode.value, 'ids')
	assert.equal(view.buildRequest(true), null)
	view.onModuleChange({ detail: { value: ['bottle', 'gauge'] } })
	assert.deepEqual(Array.from(view.selectedModules.value), ['bottle', 'gauge'])
})

test('dashboard and route pass the combined state; old single-state links still load', async () => {
	const dashboard = fs.readFileSync('src/components/domain/dashboard/DashboardHome.vue', 'utf8')
	const goInspectionDue = dashboard.match(/function goInspectionDue\(module\) \{[\s\S]*?\n\}/)[0]
	let url = ''
	const nav = { go: (next) => { url = next }, encodeURIComponent }
	vm.runInNewContext(goInspectionDue + '\nthis.openDue = goInspectionDue', nav)
	for (const module of ['bottle', 'gauge', 'valve']) {
		nav.openDue(module)
		assert.match(url, new RegExp(`inspection_due_module=${module}&inspection_due_state=overdue_or_due_60d$`))
	}

	let onLoad
	const route = { ref: (value) => ({ value }), onLoad: (fn) => { onLoad = fn } }
	vm.runInNewContext(scriptAt('src/pages/bottle/inspection.vue') + '\nthis.route = { initialInspectionDueModule, initialInspectionDueState }', route)
	onLoad({ inspection_due_module: 'valve', inspection_due_state: 'overdue_or_due_60d' })
	assert.equal(route.route.initialInspectionDueState.value, 'overdue_or_due_60d')
	const combined = makeInspectionView(route.route.initialInspectionDueModule.value, route.route.initialInspectionDueState.value)
	combined.context.mount()
	await Promise.resolve()
	assert.deepEqual(Array.from(combined.view.selectedModules.value), ['valve'])
	assert.equal(combined.requests.at(-1).inspection_due_state, 'overdue_or_due_60d')

	onLoad({ inspection_due_module: 'bottle', inspection_due_state: 'overdue' })
	assert.equal(route.route.initialInspectionDueState.value, 'overdue')
	const legacy = makeInspectionView(route.route.initialInspectionDueModule.value, route.route.initialInspectionDueState.value)
	legacy.context.mount()
	await Promise.resolve()
	assert.equal(legacy.requests.at(-1).inspection_due_state, 'overdue')
	onLoad({ inspection_due_module: 'bottle', inspection_due_state: 'due_60d' })
	assert.equal(route.route.initialInspectionDueState.value, 'due_60d')
})

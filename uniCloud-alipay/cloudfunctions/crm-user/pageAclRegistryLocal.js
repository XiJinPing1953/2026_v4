'use strict'

const ACTIONS = ['view', 'create', 'update', 'delete']

const GROUP_DEFAULTS = {
	superadmin: {
		dashboard: { view: true, create: false, update: false, delete: false },
		sales: { view: true, create: true, update: true, delete: true },
		customers: { view: true, create: true, update: true, delete: true },
		bottles: { view: true, create: true, update: true, delete: true },
		vehicles: { view: true, create: true, update: true, delete: true },
		deliveries: { view: true, create: true, update: true, delete: true },
		filling: { view: true, create: true, update: true, delete: true },
		gas: { view: true, create: true, update: true, delete: true },
		accounting: { view: true, create: true, update: true, delete: true },
		collection: { view: true, create: true, update: true, delete: true },
		logs: { view: true, create: false, update: false, delete: false },
		userAdmin: { view: true, create: true, update: true, delete: true }
	},
	admin: {
		dashboard: { view: true, create: false, update: false, delete: false },
		sales: { view: true, create: true, update: true, delete: true },
		customers: { view: true, create: true, update: true, delete: true },
		bottles: { view: true, create: true, update: true, delete: true },
		vehicles: { view: true, create: true, update: true, delete: true },
		deliveries: { view: true, create: true, update: true, delete: true },
		filling: { view: true, create: true, update: true, delete: true },
		gas: { view: true, create: true, update: true, delete: true },
		accounting: { view: true, create: true, update: true, delete: true },
		collection: { view: true, create: true, update: true, delete: true },
		logs: { view: true, create: false, update: false, delete: false },
		userAdmin: { view: false, create: false, update: false, delete: false }
	},
	finance: {
		dashboard: { view: true, create: false, update: false, delete: false },
		sales: { view: true, create: true, update: true, delete: true },
		customers: { view: true, create: true, update: true, delete: true },
		bottles: { view: true, create: true, update: true, delete: true },
		vehicles: { view: true, create: true, update: true, delete: true },
		deliveries: { view: true, create: true, update: true, delete: true },
		filling: { view: true, create: true, update: true, delete: true },
		gas: { view: true, create: true, update: true, delete: true },
		accounting: { view: true, create: true, update: true, delete: true },
		collection: { view: true, create: true, update: true, delete: true },
		logs: { view: true, create: false, update: false, delete: false },
		userAdmin: { view: false, create: false, update: false, delete: false }
	},
	user: {
		dashboard: { view: true, create: false, update: false, delete: false },
		sales: { view: true, create: true, update: true, delete: true },
		customers: { view: true, create: true, update: true, delete: true },
		bottles: { view: true, create: true, update: true, delete: true },
		vehicles: { view: true, create: true, update: true, delete: true },
		deliveries: { view: true, create: true, update: true, delete: true },
		filling: { view: true, create: true, update: true, delete: true },
		gas: { view: true, create: true, update: true, delete: true },
		accounting: { view: false, create: false, update: false, delete: false },
		collection: { view: false, create: false, update: false, delete: false },
		logs: { view: false, create: false, update: false, delete: false },
		userAdmin: { view: false, create: false, update: false, delete: false }
	}
}

const PAGE_REGISTRY = [
	{ pagePath: '/pages/index/index', label: '工作台', group: 'dashboard', supports: { view: true } },
	{ pagePath: '/pages/sale/list', label: '销售记录', group: 'sales', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/sale/edit', label: '销售录入', group: 'sales', supports: { view: true, create: true, update: true } },
	{ pagePath: '/pages/sale/settlement', label: '销售结算', group: 'sales', supports: { view: true, update: true } },
	{ pagePath: '/pages/sale/detail', label: '销售详情', group: 'sales', supports: { view: true, update: true, delete: true } },
	{ pagePath: '/pages/customer/list', label: '客户列表', group: 'customers', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/customer/edit', label: '客户录入', group: 'customers', supports: { view: true, create: true, update: true } },
	{ pagePath: '/pages/customer/statement', label: '客户对账', group: 'customers', supports: { view: true, create: true, update: true } },
	{ pagePath: '/pages/cashier/receipt-intake', label: '出纳收款登记', group: 'customers', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/bottle/anomaly', label: '流转异常', group: 'bottles', supports: { view: true, update: true } },
	{ pagePath: '/pages/bottle/list', label: '瓶档列表', group: 'bottles', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/bottle/edit', label: '瓶档录入', group: 'bottles', supports: { view: true, create: true, update: true } },
	{ pagePath: '/pages/bottle/movement', label: '流转记录', group: 'bottles', supports: { view: true } },
	{ pagePath: '/pages/bottle/timeline', label: '单瓶时间线', group: 'bottles', supports: { view: true } },
	{ pagePath: '/pages/bottle/loss', label: '损耗统计', group: 'bottles', supports: { view: true } },
	{ pagePath: '/pages/vehicle/list', label: '车辆列表', group: 'vehicles', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/vehicle/edit', label: '车辆录入', group: 'vehicles', supports: { view: true, create: true, update: true } },
	{ pagePath: '/pages/delivery/list', label: '配送员列表', group: 'deliveries', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/delivery/edit', label: '配送员录入', group: 'deliveries', supports: { view: true, create: true, update: true } },
	{ pagePath: '/pages/filling/list', label: '灌装记录', group: 'filling', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/filling/edit', label: '灌装录入', group: 'filling', supports: { view: true, update: true } },
	{ pagePath: '/pages/gas-in/list', label: '天然气入库', group: 'gas', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/gas-in/edit', label: '天然气入库录入', group: 'gas', supports: { view: true, create: true, update: true } },
	{ pagePath: '/pages/accounting/account-list', label: '科目表', group: 'accounting', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/accounting/account-edit', label: '科目录入', group: 'accounting', supports: { view: true, create: true, update: true } },
	{ pagePath: '/pages/accounting/voucher-list', label: '凭证列表', group: 'accounting', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/accounting/voucher-edit', label: '凭证录入', group: 'accounting', supports: { view: true, create: true, update: true } },
	{ pagePath: '/pages/accounting/ledger-general', label: '总账', group: 'accounting', supports: { view: true } },
	{ pagePath: '/pages/accounting/ledger-sub', label: '明细账', group: 'accounting', supports: { view: true } },
	{ pagePath: '/pages/accounting/trial-balance', label: '试算平衡', group: 'accounting', supports: { view: true } },
	{ pagePath: '/pages/accounting/report-summary', label: '报表汇总', group: 'accounting', supports: { view: true } },
	{ pagePath: '/pages/accounting/period-list', label: '账期管理', group: 'accounting', supports: { view: true, create: true, update: true, delete: true } },
	{ pagePath: '/pages/accounting/receivable-detail', label: '往来明细', group: 'accounting', supports: { view: true } },
	{ pagePath: '/pages/collection/task-list', label: '追款任务', group: 'collection', supports: { view: true, update: true } },
	{ pagePath: '/pages/collection/task-detail', label: '追款详情', group: 'collection', supports: { view: true, update: true } },
	{ pagePath: '/pages/log/list', label: '操作日志', group: 'logs', supports: { view: true } },
	{ pagePath: '/pages/user/list', label: '用户管理', group: 'userAdmin', supports: { view: true, create: true, update: true, delete: true } }
]

const PAGE_REGISTRY_MAP = PAGE_REGISTRY.reduce((map, item) => {
	map[item.pagePath] = item
	return map
}, {})

function normalizeRoleTemplate(value) {
	const role = String(value || '').trim().toLowerCase()
	return GROUP_DEFAULTS[role] ? role : 'user'
}

function normalizeSupports(supports = {}) {
	const resolved = {}
	ACTIONS.forEach((action) => {
		resolved[action] = Boolean(supports[action])
	})
	return resolved
}

function buildRoleTemplatePermissions(roleTemplate) {
	const role = normalizeRoleTemplate(roleTemplate)
	const roleDefaults = GROUP_DEFAULTS[role] || GROUP_DEFAULTS.user
	return PAGE_REGISTRY.reduce((acc, item) => {
		const base = roleDefaults[item.group] || {}
		const supports = normalizeSupports(item.supports)
		acc[item.pagePath] = ACTIONS.reduce((entry, action) => {
			entry[action] = action === 'view' ? Boolean(base.view && supports.view) : Boolean(base[action] && supports[action])
			return entry
		}, {})
		return acc
	}, {})
}

module.exports = {
	ACTIONS,
	PAGE_REGISTRY,
	PAGE_REGISTRY_MAP,
	normalizeRoleTemplate,
	buildRoleTemplatePermissions
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

const AUTH_ACTION_SET = new Set([
	'register_admin',
	'login',
	'refresh_token',
	'list_users',
	'create_user',
	'remove_user',
	'update_role',
	'user_list_v1'
])

const ACTION_LABEL_MAP = {
	register_admin: '初始化管理员账号',
	login: '用户登录',
	refresh_token: '刷新登录令牌',
	list_users: '查询用户列表',
	create_user: '创建用户',
	remove_user: '删除用户',
	update_role: '修改用户角色',
	user_list_v1: '搜索用户列表',

	customer_create_v1: '创建客户档案',
	customer_update_v1: '更新客户档案',

	sale_create_v2: '创建销售单',
	sale_update_v2: '更新销售单',
	sale_remove_v2: '删除销售单',
	sale_voucher_sync_v1: '同步销售凭证',
	sale_anomaly_touch_v2_failed: '销售后异常增量扫描失败',

	bottle_create_v1: '创建钢瓶档案',
	bottle_update_v1: '更新钢瓶档案',
	bottle_anomaly_scan_v1: '扫描钢瓶异常',
	bottle_anomaly_scan_v2: '扫描钢瓶异常',
	bottle_anomaly_rebuild_v2: '全量重建钢瓶异常',
	bottle_anomaly_touch_v2: '增量扫描钢瓶异常',
	bottle_anomaly_resolve_v1: '处理钢瓶异常',
	bottle_movement_list_v1: '查询钢瓶流转记录',
	bottle_movement_timeline_v1: '查询单瓶流转时间线',
	bottle_movement_create_v1: '记录钢瓶流转',
	bottle_movement_loss_stats_v1: '查询损耗统计',
	bottle_movement_cycle_loss_v1: '查询单瓶理论损耗',
	bottle_batch_update_inspection_preview_v2: '预检钢瓶检验登记',
	bottle_batch_update_inspection_execute_v2: '执行钢瓶检验登记',

	filling_create_v1: '创建灌装记录',
	filling_get_v1: '查询灌装记录详情',
	filling_update_v1: '更新灌装记录',
	filling_remove_v1: '删除灌装记录',
	filling_batch_create_v1: '批量新增灌装记录',
	filling_batch_update_date_v1: '批量修改灌装日期',
	filling_list_v1: '查询灌装记录',
	filling_anomaly_touch_v2_failed: '灌装后异常增量扫描失败',

	vehicle_create_v1: '创建车辆档案',
	vehicle_update_v1: '更新车辆档案',
	rfid_gateway_login: 'RFID 网关登录',
	rfid_gateway_login_failed: 'RFID 网关登录失败',
	rfid_gateway_ingest_session: 'RFID 会话入库',
	rfid_bind_epc: 'RFID 标签绑定',
	rfid_unbind_epc: 'RFID 标签解绑',
	delivery_create_v1: '创建配送员档案',
	delivery_update_v1: '更新配送员档案',

	account_create_v1: '创建会计科目',
	account_update_v1: '更新会计科目',
	voucher_create_v1: '创建会计凭证',
	voucher_update_v1: '更新会计凭证',
	voucher_post_v1: '凭证过账',
	voucher_unpost_v1: '凭证反过账',
	period_create_v1: '创建账期',
	period_close_v1: '账期结账',
	period_reopen_v1: '账期反结账',
	ledger_trial_balance_v1: '查询试算平衡',
	ledger_general_v1: '查询总账',
	ledger_sub_v1: '查询明细账',
	ledger_receivable_detail_v1: '查询往来明细',
	report_summary_v1: '查询财务报表汇总',

	dashboard_summary_v1: '查询工作台汇总',

	collection_task_auto_create_v1: '自动生成追款任务',
	collection_task_update_v1: '更新追款任务',
	collection_followup_add_v1: '新增追款跟进',
	collection_task_recalc_v1: '重算追款任务金额',
	collection_forbidden: '追款模块权限拦截',
	operation_log_forbidden: '操作日志权限拦截',

	home_safety_inspection_submit_v1: '提交入户安全巡检单',
	home_safety_inspection_update_v1: '管理员修改入户安全巡检单',
	home_safety_inspection_number_backfill_v1: '回填巡检单编号',
	home_safety_inspection_export_create_v1: '创建巡检记录导出',
	home_safety_inspection_export_download_v1: '下载巡检记录导出',
	station_safety_inspection_submit_v1: '提交厂站安全巡检单',
	station_safety_inspection_update_v1: '管理员修改厂站安全巡检单',
	station_safety_hazard_rectify_v1: '提交厂站隐患整改',
	station_safety_hazard_verify_v1: '验证厂站隐患整改',
	station_safety_hazard_admin_update_v1: '管理员修改厂站隐患闭环内容',
	station_safety_export_create_v1: '创建厂站巡检导出',
	station_safety_export_download_v1: '下载厂站巡检导出'
}

const CATEGORY_LABEL_MAP = {
	auth: '认证与用户',
	customer: '客户',
	sale: '销售',
	bottle: '钢瓶',
	filling: '灌装',
	vehicle: '车辆',
	rfid: 'RFID',
	delivery: '配送员',
	accounting: '财务',
	collection: '追款',
	dashboard: '工作台',
	inspection: '入户巡检',
	station_inspection: '厂站巡检',
	security: '安全',
	other: '其他'
}

export const LOG_ACTION_CATEGORY_OPTIONS = [
	{ label: '全部分类', value: '' },
	{ label: '认证与用户', value: 'auth' },
	{ label: '客户', value: 'customer' },
	{ label: '销售', value: 'sale' },
	{ label: '钢瓶', value: 'bottle' },
	{ label: '灌装', value: 'filling' },
	{ label: '车辆', value: 'vehicle' },
	{ label: 'RFID', value: 'rfid' },
	{ label: '配送员', value: 'delivery' },
	{ label: '财务', value: 'accounting' },
	{ label: '追款', value: 'collection' },
	{ label: '工作台', value: 'dashboard' },
	{ label: '入户巡检', value: 'inspection' },
	{ label: '厂站巡检', value: 'station_inspection' },
	{ label: '安全', value: 'security' },
	{ label: '其他', value: 'other' }
]

export function getLogActionCategory(action) {
	const normalized = normalizeString(action).toLowerCase()
	if (!normalized) return 'other'
	if (normalized.includes('forbidden')) return 'security'
	if (AUTH_ACTION_SET.has(normalized)) return 'auth'
	if (normalized.startsWith('customer_')) return 'customer'
	if (normalized.startsWith('sale_')) return 'sale'
	if (/^bottle(_anomaly|_movement)?_/.test(normalized)) return 'bottle'
	if (normalized.startsWith('filling_')) return 'filling'
	if (normalized.startsWith('vehicle_')) return 'vehicle'
	if (normalized.startsWith('rfid_')) return 'rfid'
	if (normalized.startsWith('delivery_')) return 'delivery'
	if (
		normalized.startsWith('account_') ||
		normalized.startsWith('voucher_') ||
		normalized.startsWith('ledger_') ||
		normalized.startsWith('period_') ||
		normalized.startsWith('report_')
	) {
		return 'accounting'
	}
	if (normalized.startsWith('collection_')) return 'collection'
	if (normalized.startsWith('dashboard_')) return 'dashboard'
	if (normalized.startsWith('home_safety_inspection_')) return 'inspection'
	if (normalized.startsWith('station_safety_')) return 'station_inspection'
	return 'other'
}

export function getLogActionCategoryLabel(category) {
	const key = normalizeString(category).toLowerCase()
	return CATEGORY_LABEL_MAP[key] || CATEGORY_LABEL_MAP.other
}

function inferActionVerb(action) {
	const normalized = normalizeString(action).toLowerCase()
	if (!normalized) return ''
	if (normalized.includes('auto_create')) return '自动生成'
	if (normalized.includes('recalc')) return '重算'
	if (normalized.includes('unpost')) return '反过账'
	if (normalized.includes('post')) return '过账'
	if (normalized.includes('reopen')) return '反结账'
	if (normalized.includes('close')) return '结账'
	if (normalized.includes('create')) return '创建'
	if (normalized.includes('update')) return '更新'
	if (normalized.includes('remove') || normalized.includes('delete')) return '删除'
	if (normalized.includes('add')) return '新增'
	if (normalized.includes('resolve')) return '处理'
	if (normalized.includes('scan')) return '扫描'
	if (normalized.includes('list') || normalized.includes('get') || normalized.includes('summary')) return '查询'
	if (normalized.includes('sync')) return '同步'
	if (normalized.includes('refresh')) return '刷新'
	if (normalized.includes('login')) return '登录'
	if (normalized.includes('forbidden')) return '拦截'
	return ''
}

export function getLogActionLabel(action) {
	const normalized = normalizeString(action).toLowerCase()
	if (!normalized) return '未命名操作'
	const mapped = ACTION_LABEL_MAP[normalized]
	if (mapped) return mapped
	const category = getLogActionCategory(normalized)
	const categoryLabel = getLogActionCategoryLabel(category)
	const verb = inferActionVerb(normalized)
	if (!verb) return `${categoryLabel}相关操作`
	return `${verb}${categoryLabel}相关记录`
}

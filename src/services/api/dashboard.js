import { callCloud } from './callCloud'

export function getOperatingBriefV1(period) {
	return callCloud('crm-dashboard', {
		action: 'summaryV1',
		data: { section: 'brief', period },
		timeout: 60000
	})
}

export function getDashboardDailyReportV1({ start, end }) {
	return callCloud('crm-dashboard', {
		action: 'summaryV1',
		data: { section: 'daily_report', date_start: start, date_end: end },
		timeout: 60000
	})
}

export function getOperatingCurrentV1() {
	return callCloud('crm-dashboard', {
		action: 'summaryV1',
		data: { section: 'current' },
		timeout: 60000
	})
}

export function getOperatingTankLossV1(period) {
	return callCloud('crm-dashboard', {
		action: 'summaryV1',
		data: { section: 'tank_loss', period },
		timeout: 60000
	})
}

import { isLoggedIn } from '../services/auth'
import { goLogin } from '../services/navigation'
import { canPageAction as canPageActionByPath, canViewPage as canViewPageByPath, normalizePagePath } from '../services/pageAcl'

function resolveCurrentPagePath() {
	const pages = getCurrentPages()
	const current = pages[pages.length - 1]
	if (!current?.route) return ''
	return normalizePagePath(current.route)
}

// 页面容器里调用：
// const { requireLogin } = useAuthGuard(); if (!requireLogin()) return;
export function useAuthGuard() {
	function requireLogin() {
		if (isLoggedIn()) return true
		goLogin()
		return false
	}

	function requirePageView(pagePath = '') {
		if (!requireLogin()) return false
		const target = normalizePagePath(pagePath || resolveCurrentPagePath())
		if (!target) return true
		return canViewPageByPath(target)
	}

	function canPageAction(pagePath = '', action = 'view') {
		const target = normalizePagePath(pagePath || resolveCurrentPagePath())
		if (!target) return false
		return canPageActionByPath(target, action)
	}

	function canViewPage(pagePath = '') {
		const target = normalizePagePath(pagePath || resolveCurrentPagePath())
		if (!target) return false
		return canViewPageByPath(target)
	}

	return { requireLogin, requirePageView, canPageAction, canViewPage }
}

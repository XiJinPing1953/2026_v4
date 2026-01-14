import { isLoggedIn } from '../services/auth'
import { goLogin } from '../services/navigation'

// 页面容器里调用：
// const { requireLogin } = useAuthGuard(); if (!requireLogin()) return;
export function useAuthGuard() {
	function requireLogin() {
		if (isLoggedIn()) return true
		goLogin()
		return false
	}

	return { requireLogin }
}

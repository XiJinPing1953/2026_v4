const LAST_CHECK_AT_KEY = '__crm_h5_version_last_check_at__'
const LAST_REMOTE_ENTRY_KEY = '__crm_h5_version_last_remote_entry__'
const RELOAD_ONCE_KEY = '__crm_h5_version_reload_once__'
const CHECK_INTERVAL_MS = 30 * 1000

function isH5Runtime() {
	return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function nowMs() {
	return Date.now()
}

function normalizePath(urlText = '') {
	try {
		const url = new URL(urlText, window.location.origin)
		return `${url.pathname}${url.search || ''}`
	} catch (error) {
		return String(urlText || '').trim()
	}
}

function getCurrentEntryScriptPath() {
	const script = document.querySelector('script[type="module"][src*="index-"]')
	if (!script) return ''
	return normalizePath(script.getAttribute('src') || '')
}

async function fetchVersionMeta() {
	const stamp = nowMs()
	const response = await fetch(`/version.json?_t=${stamp}`, {
		cache: 'no-store',
		headers: {
			'cache-control': 'no-cache'
		}
	})
	if (!response.ok) return null
	return response.json()
}

function markReloadOnce(remoteEntryScript) {
	try {
		sessionStorage.setItem(RELOAD_ONCE_KEY, remoteEntryScript)
	} catch (error) {}
}

function hasReloadedFor(remoteEntryScript) {
	try {
		return sessionStorage.getItem(RELOAD_ONCE_KEY) === remoteEntryScript
	} catch (error) {
		return false
	}
}

function updateLastRemoteEntry(remoteEntryScript) {
	try {
		localStorage.setItem(LAST_REMOTE_ENTRY_KEY, remoteEntryScript)
	} catch (error) {}
}

function getLastRemoteEntry() {
	try {
		return localStorage.getItem(LAST_REMOTE_ENTRY_KEY) || ''
	} catch (error) {
		return ''
	}
}

function shouldSkipCheck(force = false) {
	if (force) return false
	try {
		const lastAt = Number(sessionStorage.getItem(LAST_CHECK_AT_KEY) || 0)
		if (!Number.isFinite(lastAt)) return false
		return nowMs() - lastAt < CHECK_INTERVAL_MS
	} catch (error) {
		return false
	}
}

function markCheckedNow() {
	try {
		sessionStorage.setItem(LAST_CHECK_AT_KEY, String(nowMs()))
	} catch (error) {}
}

function reloadWithVersion(remoteEntryScript = '') {
	const url = new URL(window.location.href)
	const versionTag = String(remoteEntryScript || '')
		.replace(/[^a-zA-Z0-9_-]/g, '')
		.slice(-24)
	if (versionTag) {
		url.searchParams.set('__h5v', versionTag)
	}
	window.location.replace(url.toString())
}

export async function ensureLatestH5Bundle(options = {}) {
	const force = Boolean(options.force)
	if (!isH5Runtime()) return
	if (process.env.NODE_ENV !== 'production') return
	if (shouldSkipCheck(force)) return
	markCheckedNow()

	let versionMeta = null
	try {
		versionMeta = await fetchVersionMeta()
	} catch (error) {
		return
	}
	const remoteEntryScript = normalizePath(versionMeta?.entryScript || '')
	if (!remoteEntryScript) return

	const currentEntryScript = getCurrentEntryScriptPath()
	const lastRemoteEntry = getLastRemoteEntry()
	updateLastRemoteEntry(remoteEntryScript)

	if (!currentEntryScript) return
	if (currentEntryScript === remoteEntryScript) return
	if (hasReloadedFor(remoteEntryScript)) return

	// First time opening after deployment: if we already know an older remote entry,
	// it means we truly switched versions and should force one refresh.
	if (lastRemoteEntry && lastRemoteEntry !== remoteEntryScript) {
		markReloadOnce(remoteEntryScript)
		reloadWithVersion(remoteEntryScript)
		return
	}

	// Even without historical marker, current entry and remote entry mismatch indicates
	// stale index/html cache. Force one versioned reload to pull the latest bundle.
	markReloadOnce(remoteEntryScript)
	reloadWithVersion(remoteEntryScript)
}

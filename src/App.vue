<script>
import { getUser, syncCurrentUser } from '@/services/auth'
import { ensureLatestH5Bundle } from '@/services/h5VersionGuard'
import { consumePendingLoginRedirect, goLogin } from '@/services/navigation'
import { canViewPage } from '@/services/pageAcl'
import {
  normalizeAppPagePath,
  resolveHomePath,
  resolveLoginRedirectForRuntime,
  shouldRedirectToPreferredHome
} from '@/services/pda/entry'
import { restoreScannerProfile } from '@/services/pda/capture'

export default {
  async onLaunch() {
    console.log('App Launch')
    await ensureLatestH5Bundle({ force: true })
    await this.bootstrapAuth()
  },
  async onShow() {
    console.log('App Show')
    await ensureLatestH5Bundle()
    await this.bootstrapAuth()
  },
  onHide() {
    console.log('App Hide')
    restoreScannerProfile({ reason: 'app-hide' })
  },
  methods: {
    async bootstrapAuth() {
      const cachedUser = getUser()
      const cachedPages = getCurrentPages()
      const cachedCurrent = cachedPages[cachedPages.length - 1]
      const cachedCurrentPath = cachedCurrent?.route || ''
      if (cachedUser && shouldRedirectToPreferredHome(cachedCurrentPath, cachedUser)) {
        uni.reLaunch({ url: resolveHomePath(cachedUser) })
        return
      }
      const result = await syncCurrentUser({ force: true })
      if (result?.code === 401) {
        goLogin({ captureCurrent: true })
        return
      }
      const user = result?.user || getUser()
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const currentPath = current?.route || ''
      if (currentPath === 'pages/login/login') {
        const pendingRedirect = consumePendingLoginRedirect()
        const runtimeRedirect = resolveLoginRedirectForRuntime(pendingRedirect, user)
        const redirectPath = normalizeAppPagePath(runtimeRedirect)
        if (runtimeRedirect && redirectPath && user && canViewPage(redirectPath, user)) {
          uni.reLaunch({ url: runtimeRedirect })
          return
        }
      }
      if (shouldRedirectToPreferredHome(currentPath, user)) {
        uni.reLaunch({ url: resolveHomePath(user) })
      }
    }
  }
}
</script>

<style lang="scss">
@import "@/uni.scss";

page {
	background: var(--crm-bg);
	color: var(--crm-text);
}
</style>

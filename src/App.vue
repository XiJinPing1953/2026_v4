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

let authBootstrapPromise = null

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
      if (authBootstrapPromise) return authBootstrapPromise
      authBootstrapPromise = this.checkAuthAndRedirect().finally(() => { authBootstrapPromise = null })
      return authBootstrapPromise
    },
    async checkAuthAndRedirect() {
      const result = await syncCurrentUser({ force: true })
      if (result?.code === 401) {
        await goLogin({ captureCurrent: true })
        return
      }
      const user = result?.user || getUser()
      if (!user) return
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const currentPath = current?.route || ''
      if (currentPath === 'pages/login/login') {
        const pendingRedirect = consumePendingLoginRedirect()
        const runtimeRedirect = resolveLoginRedirectForRuntime(pendingRedirect, user)
        const redirectPath = normalizeAppPagePath(runtimeRedirect)
        if (runtimeRedirect && redirectPath && user && canViewPage(redirectPath, user)) {
          await uni.reLaunch({ url: runtimeRedirect })
          return
        }
      }
      if (shouldRedirectToPreferredHome(currentPath, user)) {
        await uni.reLaunch({ url: resolveHomePath(user) })
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
/* #ifdef H5 */
@media (max-width:767px) {
 page { --crm-font-xs:12px; --crm-font-sm:14px; --crm-font-md:16px; --crm-font-lg:18px; }
 button { min-height:44px; }
 input, textarea, .uni-input-input, .uni-textarea-textarea { font-size:16px; }
 textarea { max-width:100%; box-sizing:border-box; }
}
/* #endif */
</style>

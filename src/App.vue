<script>
import { getUser, syncCurrentUser } from '@/services/auth'
import { ensureLatestH5Bundle } from '@/services/h5VersionGuard'
import { goLogin } from '@/services/navigation'
import { resolveHomePath, shouldRedirectToPreferredHome } from '@/services/pda/entry'

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
  },
  methods: {
    async bootstrapAuth() {
      const result = await syncCurrentUser({ force: true })
      if (result?.code === 401) {
        goLogin()
        return
      }
      const user = result?.user || getUser()
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const currentPath = current?.route || ''
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

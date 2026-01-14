<script>
export default {
  onLaunch: function () {
    console.log('App Launch')
  },
  onShow: function () {
    console.log('App Show')
  },
  onHide: function () {
    console.log('App Hide')
  },
}
</script>

<style lang="scss">
@use "@/uni.scss" as *;

page {
	background: var(--crm-bg);
	color: var(--crm-text);
}
</style>


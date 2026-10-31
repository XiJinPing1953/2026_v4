import { getCurrentInstance, nextTick } from 'vue'

// Keep pagination available where reading finishes, then show the next page's top.
export function useRecordPageScroll(selector) {
 const instance = getCurrentInstance()
 return async () => {
  await nextTick()
  if (typeof uni.createSelectorQuery !== 'function' || typeof uni.pageScrollTo !== 'function') return
  const query = uni.createSelectorQuery().in(instance?.proxy)
  query.select(selector).boundingClientRect()
  query.selectViewport().scrollOffset()
  query.exec(result => {
   if (!result?.[0] || !result?.[1]) return
   uni.pageScrollTo({ scrollTop: Math.max(0, result[0].top + result[1].scrollTop - 8), duration: 0 })
  })
 }
}

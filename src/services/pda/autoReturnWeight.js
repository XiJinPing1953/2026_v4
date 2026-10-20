// 回瓶与罐装复秤共用的自动候选；不改变秤协议、提交规则或持久化格式。
export function createAutoReweighWeight() {
 let anchor = null, accepted = null, candidate = null, since = 0, previous = 0
 function interrupt() { candidate = null; since = 0; previous = 0 }
 function reset() { anchor = null; accepted = null; interrupt() }
 function feed(frame, tare, now = Date.now()) {
  const t = Number(frame.sampled_at), w = Number(frame.display_kg)
  if (!Number.isFinite(w) || !Number.isFinite(t) || t <= 0 || t > now || now - t > 3000) { interrupt(); return null }
  if (previous && (t < previous || t - previous > 300)) { interrupt() }
  previous = t
  const floor = Number(tare) > 0 ? Number(tare) * 0.5 : 0
  // 锚点仅随更高的有效悬重上移，不随小幅下降移动，防止阶梯式卸瓶绕过保护。
  if (w <= 0 || w < floor || (anchor !== null && w < anchor * 0.95)) { candidate = null; since = 0; return null }
  if (candidate !== w) { candidate = w; since = t }
  if (t - since < 3000 || accepted === w) return null
  if (anchor === null || w > anchor) anchor = w
  accepted = w
  return w
 }
 return { feed, reset, interrupt }
}

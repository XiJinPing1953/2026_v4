// 回瓶与罐装复秤共用的自动候选；不改变秤协议、提交规则或持久化格式。
export function createAutoReweighWeight(stableMs = 3000) {
 let anchor = null, accepted = null, candidate = null, since = 0, previous = 0
 function interrupt() { candidate = null; since = 0; previous = 0 }
 function reset() { anchor = null; accepted = null; interrupt() }
 function minimumWeight(tare) {
  return Math.max(Number(tare) > 0 ? Number(tare) * 0.5 : 0, anchor !== null ? anchor * 0.95 : 0)
 }
 function feed(frame, tare, now = Date.now()) {
  const t = Number(frame.sampled_at), w = Number(frame.display_kg)
  if (!Number.isFinite(w) || !Number.isFinite(t) || t <= 0 || t > now || now - t > 3000) { interrupt(); return null }
  if (previous && (t < previous || t - previous > 300)) { interrupt() }
  previous = t
  // 锚点仅随更高的有效悬重上移，不随小幅下降移动，防止阶梯式卸瓶绕过保护。
  if (w <= 0 || w < minimumWeight(tare)) { candidate = null; since = 0; return null }
  if (candidate !== w) { candidate = w; since = t }
  if (t - since < stableMs || accepted === w) return null
  if (anchor === null || w > anchor) anchor = w
  accepted = w
  return w
 }
 return { feed, reset, interrupt, minimumWeight }
}

// Candidate engineering limits; field loaded-noise acceptance remains separate.
export const FLOOR_REWEIGH_POLICY = Object.freeze({ stableMs: 1500, rangeKg: 0.1, maxGapMs: 500, freshMs: 500, minimumSamples: 3, hysteresisKg: 0.03 })

// Raw samples qualify stability independently of the half-kg displayed value.
export function createFloorReweighWeight(stableMs = FLOOR_REWEIGH_POLICY.stableMs, options = {}) {
 const policy = { ...FLOOR_REWEIGH_POLICY, ...options, stableMs }
 let rows = [], previous = 0, stable = false
 function interrupt() { rows = []; previous = 0; stable = false }
 function suspend() { stable = false }
 function feed(frame, _tare, now = Date.now()) {
  const t = Number(frame.sampled_at), w = Number(frame.display_kg), raw = Number(frame.raw_kg)
  if (frame.raw_kg == null || !Number.isFinite(raw) || !Number.isFinite(w) || !Number.isFinite(t) || t <= 0 || t > now || now - t > policy.freshMs) { interrupt(); return null }
  if (previous && (t < previous || t - previous > policy.maxGapMs)) interrupt()
  previous = t
  rows.push({ t, raw })
  // Keep the sample at/before the window boundary, as the calibration window does.
  while (rows.length > 1 && rows[1].t <= t - policy.stableMs) rows.shift()
  if (rows.length > 256) rows.shift()
  const values = rows.map(row => row.raw)
  stable = rows.length >= policy.minimumSamples && t - rows[0].t >= policy.stableMs &&
   Math.max(...values) - Math.min(...values) <= policy.rangeKg + 0.000001
  return w
 }
 return { feed, interrupt, suspend, reset: interrupt, minimumWeight: () => 0, get stable() { return stable } }
}

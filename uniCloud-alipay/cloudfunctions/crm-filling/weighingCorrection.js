'use strict'

function resolveWeighingCorrection(data, old) {
	const has = (key) => Object.prototype.hasOwnProperty.call(data, key)
	if (!has('weight_start') && !has('weight_end')) return { ok: true, fields: null }
	const version = Number(data.expected_source_version)
	if (!has('expected_source_version') || !Number.isInteger(version) || version < 0) {
		return { ok: false, code: 400, msg: '更正称重需提供原记录版本' }
	}
	if (version !== Number(old.source_version || 0)) return { ok: false, code: 409, msg: '原记录已变化，请重新核对' }
	const start = has('weight_start') ? data.weight_start : old.weight_start
	const end = has('weight_end') ? data.weight_end : old.weight_end
	if (start == null || start === '' || end == null || end === '' ||
		!Number.isFinite(Number(start)) || !Number.isFinite(Number(end)) || Number(start) <= 0 || Number(end) <= Number(start)) {
		return { ok: false, code: 400, msg: '灌完总重必须大于有效上秤重量' }
	}
	const net = Math.round((Number(end) - Number(start)) * 1000) / 1000
	if (has('fill_weight') && (data.fill_weight == null || data.fill_weight === '' ||
		!Number.isFinite(Number(data.fill_weight)) || Math.abs(Number(data.fill_weight) - net) > 0.0005)) {
		return { ok: false, code: 400, msg: '净灌装量与两次称重差额不一致' }
	}
	return { ok: true, fields: { weight_start: Number(start), weight_end: Number(end), actual_net_weight: net, fill_weight: net } }
}

module.exports = { resolveWeighingCorrection }

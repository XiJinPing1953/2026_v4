import { ref } from 'vue'
import { getUser } from '@/services/auth'
import { createPdaFillingForm, resolvePdaScaleGrossWeight, submitPdaFilling } from '@/services/pda/filling'
import { normalizeBottleNo, todayDate, toNumber } from '@/services/pda/shared'

const FILLING_WEIGHT_DECIMALS = 3

function formatFillingWeight(value) {
	const num = toNumber(value, null)
	if (num == null) return ''
	return Number(num).toFixed(FILLING_WEIGHT_DECIMALS)
}

function roundFillingWeight(value) {
	const num = toNumber(value, null)
	if (num == null) return null
	return Number(num.toFixed(FILLING_WEIGHT_DECIMALS))
}

export function usePdaFillingForm(initialValues = {}) {
	const currentUser = getUser() || {}
	const form = ref({
		...createPdaFillingForm(currentUser),
		...initialValues
	})
	const submitting = ref(false)
	const resolvingFillWeight = ref(false)

	function normalizeBottleInput() {
		form.value.bottleNo = normalizeBottleNo(form.value.bottleNo)
	}

	function resetForm() {
		const keepDate = form.value.date || todayDate()
		form.value = {
			...createPdaFillingForm(currentUser),
			date: keepDate
		}
	}

	function applyBottleSelection(bottle = null) {
		const bottleNo = normalizeBottleNo(bottle?.bottle_no || bottle?.bottleNo || form.value.bottleNo)
		const previousBottleNo = normalizeBottleNo(form.value.bottleNo)
		if (bottleNo) form.value.bottleNo = bottleNo
		if (bottleNo && previousBottleNo && bottleNo !== previousBottleNo) {
			form.value.weightStart = ''
			form.value.targetNetWeight = ''
			form.value.targetGrossWeight = ''
			form.value.weightEnd = ''
			form.value.actualNetWeight = ''
			form.value.deviation = ''
			form.value.fillWeight = ''
			form.value.fillWeightResolved = false
			form.value.startedAt = null
			form.value.endedAt = null
			form.value.status = 'pending'
			form.value.alarmState = false
			form.value.captureMeta = {
				bottle: null,
				startWeight: null,
				targetWeight: null,
				endWeight: null
			}
		}
		form.value.captureMeta = {
			...(form.value.captureMeta || {}),
			bottle: bottle || null
		}
	}

	function computeTargetWeights() {
		const start = toNumber(form.value.weightStart, null)
		const netTarget = toNumber(form.value.targetNetWeight, null)
		const grossTarget = toNumber(form.value.targetGrossWeight, null)
		if (form.value.targetInputMode === 'gross') {
			if (start != null && grossTarget != null) {
				form.value.targetNetWeight = formatFillingWeight(Math.max(grossTarget - start, 0))
			}
			return
		}
		if (start != null && netTarget != null) {
			form.value.targetGrossWeight = formatFillingWeight(start + netTarget)
		}
	}

	function computeActualWeights() {
		const start = toNumber(form.value.weightStart, null)
		const end = toNumber(form.value.weightEnd, null)
		const targetNet = toNumber(form.value.targetNetWeight, null)
		if (start != null && end != null) {
			const actual = roundFillingWeight(end - start)
			form.value.actualNetWeight = actual != null && actual > 0 ? formatFillingWeight(actual) : ''
			form.value.fillWeight = form.value.actualNetWeight
			if (actual != null && targetNet != null) {
				form.value.deviation = formatFillingWeight(actual - targetNet)
			} else {
				form.value.deviation = ''
			}
			form.value.fillWeightResolved = Boolean(actual != null && actual > 0)
			return
		}
		form.value.actualNetWeight = ''
		form.value.fillWeight = ''
		form.value.deviation = ''
		form.value.fillWeightResolved = false
	}

	async function readStartWeight(options = {}) {
		resolvingFillWeight.value = true
		try {
			const res = await resolvePdaScaleGrossWeight(options)
			if (res?.code !== 0) return res
			form.value.weightStart = formatFillingWeight(res.data.weightKg)
			form.value.captureMeta = {
				...(form.value.captureMeta || {}),
				startWeight: res.data.meta || null
			}
			computeTargetWeights()
			computeActualWeights()
			return res
		} finally {
			resolvingFillWeight.value = false
		}
	}

	function setTargetInputMode(mode) {
		form.value.targetInputMode = mode === 'gross' ? 'gross' : 'net'
		computeTargetWeights()
		computeActualWeights()
	}

	function setTargetNetWeight(value) {
		form.value.targetInputMode = 'net'
		form.value.targetNetWeight = value == null ? '' : String(value)
		computeTargetWeights()
		computeActualWeights()
	}

	function setTargetGrossWeight(value) {
		form.value.targetInputMode = 'gross'
		form.value.targetGrossWeight = value == null ? '' : String(value)
		computeTargetWeights()
		computeActualWeights()
	}

	function markFillingStarted() {
		const startedAt = Date.now()
		form.value.startedAt = startedAt
		form.value.status = 'filling'
		form.value.captureMeta = {
			...(form.value.captureMeta || {}),
			targetWeight: {
				source: form.value.targetInputMode === 'gross' ? 'manual_gross' : 'net_plus_start',
				weight_start: toNumber(form.value.weightStart, null),
				target_net_weight: toNumber(form.value.targetNetWeight, null),
				target_gross_weight: toNumber(form.value.targetGrossWeight, null),
				started_at: startedAt
			}
		}
		return { code: 0, msg: '', data: { startedAt } }
	}

	async function readEndWeight(options = {}) {
		resolvingFillWeight.value = true
		try {
			const res = await resolvePdaScaleGrossWeight(options)
			if (res?.code === 0) {
				const endedAt = Date.now()
				form.value.weightEnd = formatFillingWeight(res.data.weightKg)
				form.value.endedAt = endedAt
				form.value.status = 'completed'
				form.value.captureMeta = {
					...(form.value.captureMeta || {}),
					endWeight: {
						...(res.data.meta || null),
						ended_at: endedAt
					}
				}
				computeActualWeights()
			}
			return res
		} finally {
			resolvingFillWeight.value = false
		}
	}

	async function submit() {
		submitting.value = true
		try {
			const res = await submitPdaFilling(form.value, currentUser)
			if (res?.code === 0) resetForm()
			return res
		} finally {
			submitting.value = false
		}
	}

	return {
		form,
		submitting,
		resolvingFillWeight,
		normalizeBottleInput,
		applyBottleSelection,
		readStartWeight,
		setTargetInputMode,
		setTargetNetWeight,
		setTargetGrossWeight,
		markFillingStarted,
		readEndWeight,
		resetForm,
		submit
	}
}

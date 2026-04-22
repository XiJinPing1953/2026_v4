import { ref } from 'vue'
import { getUser } from '@/services/auth'
import { createPdaFillingForm, resolvePdaFillingWeight, submitPdaFilling } from '@/services/pda/filling'
import { normalizeBottleNo, todayDate } from '@/services/pda/shared'

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
		if (bottleNo) form.value.bottleNo = bottleNo
		form.value.captureMeta = {
			...(form.value.captureMeta || {}),
			bottle: bottle || null
		}
	}

	function setAfterFillTotalWeight(value, meta = null) {
		form.value.afterFillTotalWeight = value == null ? '' : String(value)
		form.value.captureMeta = {
			...(form.value.captureMeta || {}),
			totalWeight: meta || form.value.captureMeta?.totalWeight || null
		}
		form.value.fillWeightResolved = false
	}

	async function resolveFillWeightFromTotal(options = {}) {
		resolvingFillWeight.value = true
		try {
			const res = await resolvePdaFillingWeight(form.value, options)
			if (res?.code === 0) {
				form.value.fillWeight = String(res.data.fillWeight)
				setAfterFillTotalWeight(res.data.afterFillTotalWeight, {
					...(res.data.totalWeightMeta || null),
					resolved: res.data.raw || null
				})
				form.value.fillWeightResolved = true
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
		setAfterFillTotalWeight,
		resolveFillWeightFromTotal,
		resetForm,
		submit
	}
}

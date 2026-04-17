import { ref } from 'vue'
import { getUser } from '@/services/auth'
import { createPdaFillingForm, submitPdaFilling } from '@/services/pda/filling'
import { normalizeBottleNo, todayDate } from '@/services/pda/shared'

export function usePdaFillingForm(initialValues = {}) {
	const currentUser = getUser() || {}
	const form = ref({
		...createPdaFillingForm(currentUser),
		...initialValues
	})
	const submitting = ref(false)

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
		normalizeBottleInput,
		resetForm,
		submit
	}
}

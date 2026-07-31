function text(value) {
	return String(value || '').trim()
}

export function finiteLocationNumber(value) {
	if (value == null || typeof value === 'boolean') return null
	if (typeof value === 'string' && !value.trim()) return null
	const number = Number(value)
	return Number.isFinite(number) ? number : null
}

export function canApplyGeocodedAddress({
	customerId,
	requestCustomerId,
	customerAddress,
	currentLocationText,
	previousGeocodedText,
	locationTextTouched
} = {}) {
	const normalizedCustomerId = text(customerId)
	return (
		Boolean(normalizedCustomerId) &&
		normalizedCustomerId === text(requestCustomerId) &&
		!text(customerAddress) &&
		!locationTextTouched &&
		(!text(currentLocationText) ||
			text(currentLocationText) === text(previousGeocodedText))
	)
}

export function shouldInvalidateAutomaticAddress({
	customerAddress,
	currentLocationText,
	previousGeocodedText,
	locationTextTouched
} = {}) {
	return (
		!text(customerAddress) &&
		!locationTextTouched &&
		Boolean(text(previousGeocodedText)) &&
		text(currentLocationText) === text(previousGeocodedText)
	)
}

export function restoredLocationText({
	currentCustomerAddress,
	draftCustomerAddress,
	draftLocationText,
	locationTextTouched
} = {}) {
	if (locationTextTouched === false && text(currentCustomerAddress)) {
		return text(currentCustomerAddress)
	}
	const draftUsedCustomerAddress =
		locationTextTouched !== true &&
		Boolean(text(draftCustomerAddress)) &&
		text(draftLocationText) === text(draftCustomerAddress)
	return draftUsedCustomerAddress
		? text(currentCustomerAddress)
		: String(draftLocationText || '')
}

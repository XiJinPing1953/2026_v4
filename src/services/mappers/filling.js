// Weighing timestamps are milliseconds; CRM business time is UTC+8.
export function formatFillingTime(row) {
	const measuredAt = row?.entry_source === 'pda_reweigh'
		? row.reweigh?.backfill?.measured_at || row.reweigh?.original_ble_capture?.sampled_at || row.reweigh?.measured_at : null
	if (measuredAt != null && measuredAt !== '' && Number.isFinite(Number(measuredAt)) && Number(measuredAt) > 0) {
		const date = new Date(Number(measuredAt) + 8 * 3600000)
		if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 16).replace('T', ' ')
	}
	// Old hour-only business dates do not contain a measured minute.
	return String(row?.filling_time || row?.date || '').replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})$/, '$1 $2时')
}

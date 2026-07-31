export function captureWgs84Location() {
	return new Promise((resolve) => {
		const capturedAt = Date.now()
		uni.getLocation({
			type: 'wgs84',
			isHighAccuracy: true,
			highAccuracyExpireTime: 8000,
			success(res) {
				resolve({
					status: 'ok',
					coordinate_type: 'wgs84',
					latitude: Number(res.latitude),
					longitude: Number(res.longitude),
					accuracy: Number.isFinite(Number(res.accuracy)) ? Number(res.accuracy) : null,
					captured_at: capturedAt,
					source: 'home_safety_inspection_h5'
				})
			},
			fail(err) {
				resolve({
					status: 'failed',
					coordinate_type: 'wgs84',
					latitude: null,
					longitude: null,
					accuracy: null,
					error_code: String(err?.errCode || ''),
					error_message: String(err?.errMsg || '定位失败'),
					captured_at: capturedAt,
					source: 'home_safety_inspection_h5'
				})
			}
		})
	})
}

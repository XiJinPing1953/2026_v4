const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../src/services/pda/cameraScan.js'), 'utf8')
const load = () => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

async function harness(overrides = {}) {
	const { createCameraScannerLifecycle } = await load()
	const events = [], statuses = [], results = [], timers = new Map()
	let instance, time = 0, nextTimer = 0, scans = 0, workers = 0
	class Scanner {
		static NO_QR_CODE_FOUND = 'No QR code found'
		static async scanImage(video, options) { scans++; assert.ok(options.qrEngine); return overrides.scanImage ? overrides.scanImage(video, options) : { data: 'BT1|113|124' } }
		constructor(video, callback, options) { instance = this; this.callback = callback; this.options = options }
		async start() { events.push('start') }
		stop() { events.push('stop') }
		destroy() { events.push('destroy') }
	}
	const camera = createCameraScannerLifecycle({
		loadScanner: async () => Scanner,
		createSoftwareEngine() { workers++; if (overrides.workerFailure) throw new Error('Worker blocked'); return { terminate: () => events.push('terminate') } },
		onResult: text => { events.push('result'); results.push(text) }, onError: assert.fail, onStatus: status => statuses.push(status),
		now: () => time,
		setTimer(callback) { const id = ++nextTimer; timers.set(id, callback); return id }, clearTimer(id) { timers.delete(id) }
	})
	await camera.open({ videoWidth: 1920, videoHeight: 1080 })
	return { camera, events, statuses, results, timers, get instance() { return instance }, get scans() { return scans }, get workers() { return workers }, advance: ms => { time += ms }, miss: () => instance.options.onDecodeError(Scanner.NO_QR_CODE_FOUND) }
}

test('scan area covers the complete landscape and portrait preview without upscaling', async () => {
	const { getCameraScanRegion } = await load()
	assert.deepEqual(getCameraScanRegion({ videoWidth: 1920, videoHeight: 1080 }), { x: 0, y: 0, width: 1920, height: 1080, downScaledWidth: 1280, downScaledHeight: 720 })
	assert.deepEqual(getCameraScanRegion({ videoWidth: 720, videoHeight: 1280 }), { x: 0, y: 0, width: 720, height: 1280, downScaledWidth: 720, downScaledHeight: 1280 })
	assert.equal(getCameraScanRegion({ videoWidth: 640, videoHeight: 320 }).downScaledWidth, 640)
})

test('native empty results invoke local software once per second and accept its exact full string once', async () => {
	const h = await harness()
	await h.miss()
	assert.equal(h.scans, 0)
	h.advance(1000)
	await h.miss()
	assert.deepEqual(h.results, ['BT1|113|124'])
	assert.deepEqual(h.events, ['start', 'terminate', 'stop', 'result'])
	assert.equal(h.timers.size, 0)
	h.instance.callback({ data: 'DUPLICATE' })
	h.advance(1000)
	await h.miss()
	assert.equal(h.scans, 1)
	h.camera.close()
})

test('software attempts never overlap; an empty result remains retryable and normal decode misses are not errors', async () => {
	const first = deferred()
	let attempt = 0
	const h = await harness({ scanImage: () => ++attempt === 1 ? first.promise : Promise.reject('No QR code found') })
	h.advance(1000)
	const pending = h.miss()
	h.advance(1000)
	await h.miss()
	assert.equal(h.scans, 1)
	first.reject('No QR code found')
	await pending
	await h.miss()
	assert.equal(h.scans, 2)
	assert.equal(h.workers, 1)
	assert.deepEqual(h.statuses, ['starting', 'scanning'])
	h.camera.close()
})

test('native success wins a concurrent software attempt; late software output cannot overwrite it', async () => {
	const pending = deferred()
	const h = await harness({ scanImage: () => pending.promise })
	h.advance(1000)
	const scanning = h.miss()
	h.instance.callback({ data: 'NATIVE' })
	pending.resolve({ data: 'SOFTWARE' })
	await scanning
	assert.deepEqual(h.results, ['NATIVE'])
	assert.equal(h.events.filter(event => event === 'terminate').length, 1)
	h.camera.close()
})

test('close and reopen invalidate late software results and release the old worker and hint timer', async () => {
	const pending = deferred()
	const h = await harness({ scanImage: () => pending.promise })
	h.advance(1000)
	const scanning = h.miss()
	h.camera.close()
	assert.equal(h.timers.size, 0)
	assert.ok(h.events.includes('terminate'))
	await h.camera.open({ videoWidth: 640, videoHeight: 320 })
	pending.resolve({ data: 'OLD' })
	await scanning
	assert.deepEqual(h.results, [])
	h.instance.callback({ data: 'NEW' })
	assert.deepEqual(h.results, ['NEW'])
	h.camera.close()
})

test('no-result timeout and worker failure give actionable status instead of a silent live camera', async () => {
	const h = await harness({ workerFailure: true })
	for (const callback of h.timers.values()) callback()
	assert.equal(h.statuses.at(-1), 'searching')
	h.advance(1000)
	await h.miss()
	assert.equal(h.statuses.at(-1), 'software-error')
	assert.deepEqual(h.results, [])
	h.camera.close()
})

test('camera component statically bundles the public software factory and displays an uncropped preview', () => {
	const component = fs.readFileSync(path.join(__dirname, '../src/components/domain/pda/MobileQrScanner.vue'), 'utf8')
	assert.match(component, /import \{ createWorker \} from 'qr-scanner\/qr-scanner-worker\.min\.js'/)
	assert.match(component, /object-fit:contain/)
	assert.doesNotMatch(component, /object-fit:cover/)
	assert.match(component, /error \|\| scanHint/)
})

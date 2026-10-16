const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/components/domain/stationSafetyInspection/StationSafetyInspectionFormView.vue'), 'utf8')
const extract = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)))
function harness({ edit = false, draft, fail = false } = {}) {
  let now = Date.parse('2026-10-16T23:59:40+08:00'), storage = draft, calls = []
  const opened = now, ref = value => ({ value })
  const context = {
    Date: class extends Date { static now() { return now } }, Number, String, Math, Map,
    pageOpenedAt: opened, automaticStartedAt: ref(opened), automaticEndedAt: ref(0),
    startedDate: ref(''), startedTime: ref(''), endedDate: ref(''), endedTime: ref(''),
    weather: ref('晴'), editMode: ref(edit), isCurrentTemplate: ref(true), submitted: ref(false),
    loading: ref(false), saving: ref(false), dirty: ref(true), remark: ref(''), inspectorName: ref('巡检员'),
    revisionReason: ref('修改说明'), sourceRevision: ref(1), savedId: ref(''), savedDate: ref(''),
    template: ref({ template_code: 'station', template_version: 4 }), clientSubmissionId: ref('same-id'),
    draftKey: ref('draft'), flatItems: ref([]), currentStep: ref(0), reviewStep: ref(4),
    inspectionDate: ref('2026-10-16'), props: { inspectionId: 'original' },
    firstInvalid: () => null, buildItemPayload: x => x, inspectionTimestamp: () => opened,
    formatDate: date => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10),
    formatTime: date => new Date(date.getTime() + 8 * 3600000).toISOString().slice(11, 16),
    uni: { getStorageSync: () => storage, setStorageSync: (_, v) => { storage = v }, removeStorageSync: () => {}, showToast: () => {}, pageScrollTo: () => {} },
    submitStationSafetyInspectionV1: async payload => { calls.push(payload); if (fail) throw Error('response lost'); return { code: 0, data: { _id: 'saved', inspection_date: '2026-10-17' } } },
    updateStationSafetyInspectionV1: async payload => { calls.push(payload); return { code: 0, data: { _id: 'original' } } }
  }
  vm.createContext(context)
  vm.runInContext([
    extract('function showAutomaticTimes()', 'function referenceIndex'),
    extract('function restoreDraft()', 'async function load()'),
    extract('async function submit()', 'function openSavedDaily()')
  ].join('\n'), context)
  return { context, calls, opened, storage: () => storage, advance: ms => { now += ms } }
}
test('opening defaults to today; submit captures exact time across midnight without manual fields', async () => {
  const h = harness(), c = h.context
  c.showAutomaticTimes()
  assert.equal(c.startedDate.value, '2026-10-16')
  assert.equal(c.startedTime.value, '23:59')
  assert.equal(c.endedTime.value, '')
  h.advance(40001)
  await c.submit()
  assert.equal(h.calls[0].started_at, h.opened)
  assert.equal(h.calls[0].ended_at, h.opened + 40001)
  assert.equal(c.endedDate.value, '2026-10-17')
})
test('lost-response retry and resumed draft keep timestamps and submission identity', async () => {
  const h = harness({ fail: true }), c = h.context
  h.advance(12345); await c.submit()
  const saved = h.storage()
  h.advance(90000); await c.submit()
  assert.equal(h.calls[1].ended_at, h.calls[0].ended_at)
  const resumed = harness({ draft: saved })
  assert.equal(resumed.context.restoreDraft(), true)
  resumed.advance(120000); await resumed.context.submit()
  assert.equal(resumed.calls[0].started_at, h.calls[0].started_at)
  assert.equal(resumed.calls[0].ended_at, h.calls[0].ended_at)
  assert.equal(resumed.calls[0].client_submission_id, h.calls[0].client_submission_id)
})
test('invalid form never freezes end time; editing preserves original precise timestamps', async () => {
  const h = harness(), c = h.context
  c.weather.value = ''; await c.submit()
  assert.equal(c.automaticEndedAt.value, 0)
  assert.equal(h.calls.length, 0)
  const edited = harness({ edit: true })
  edited.context.automaticStartedAt.value = edited.opened - 900123
  edited.context.automaticEndedAt.value = edited.opened - 600456
  await edited.context.submit()
  assert.equal(edited.calls[0].started_at, edited.opened - 900123)
  assert.equal(edited.calls[0].ended_at, edited.opened - 600456)
})

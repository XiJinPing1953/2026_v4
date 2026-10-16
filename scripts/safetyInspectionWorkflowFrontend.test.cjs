const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const W = require('../uniCloud-alipay/cloudfunctions/crm-safety-management/workflow')
const source = fs.readFileSync(path.join(__dirname, '../src/components/domain/safetyManagement/inspectionWorkflow.js'), 'utf8')
const model = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const endedAt = Date.parse('2026-10-16T09:00:00+08:00')
const inspection = { _id: 'inspection-1', inspection_date: '2026-10-16', ended_at: endedAt, inspection_at: endedAt }

test('new observation has no default no/normal and requires actual control confirmations', async () => {
  const { hydrateWorkflow } = await model
  const draft = hydrateWorkflow({ inspection, workflow: W.emptyWorkflow(inspection), open_hazards: [{ _id: 'hazard-1' }] })
  assert.equal(draft.observed_at, endedAt)
  assert.ok(draft.special_work.every(row => row.conducted === '' && !row.events.length))
  assert.ok(Object.values(draft.activities).every(value => value === ''))
  assert.equal(draft.certificate_scope_confirmed, false)
  assert.ok(draft.facilities.every(row => row.present === '' && row.result_code === '' && row.name))
  assert.deepEqual(draft.controls[0], { hazard_id: 'hazard-1', implemented: '', changed: '', note: '', evidence: [] })
})

test('resume preserves same-day work facts, issue links, and independent not-conducted decisions through server normalization', async () => {
  const { hydrateWorkflow } = await model
  const workflow = W.emptyWorkflow(inspection)
  workflow.special_work[0] = { type: 'hot_work', conducted: 'yes', events: [{ id: 'event-1', location: '检修区', started_at: endedAt - 60000, ended_at: 0, approval: '票号-01', monitor: '实际监护人', measures: '已按票核对', result_code: 'abnormal', note: '本次发现问题', evidence: [{ type: 'record', value: '票号-01' }], hazard_ids: ['hazard-1'] }] }
  workflow.activities = { filling: 'no', unloading: 'yes', receiving: 'no', reports: 'no' }
  workflow.checks = [{ code: 'S13a', result_code: 'normal', note: '', evidence: [], hazard_ids: [], details: { hose: '符合', connections: '符合' } }]
  const before = JSON.stringify(workflow)
  const draft = hydrateWorkflow({ inspection, workflow, open_hazards: [{ _id: 'hazard-1' }] })
  const normalized = W.normalizeWorkflow(draft, inspection, endedAt + 60000)
  assert.equal(JSON.stringify(workflow), before, 'editor must not mutate returned server baseline')
  assert.equal(normalized.special_work[0].events[0].id, 'event-1')
  assert.deepEqual(normalized.special_work[0].events[0].hazard_ids, ['hazard-1'])
  assert.deepEqual(normalized.activities, workflow.activities)
  assert.equal(normalized.checks.find(row => row.code === 'S13a').details.connections, '符合')
  assert.equal(normalized.controls[0].implemented, '', 'open hazard still needs this observation confirmation')
})

test('newly discovered open hazards join a resumed draft without clearing earlier control facts', async () => {
  const { hydrateWorkflow } = await model
  const workflow = W.emptyWorkflow(inspection)
  workflow.controls = [{ hazard_id: 'old', implemented: 'yes', changed: 'no', note: '已核对', evidence: [] }]
  const draft = hydrateWorkflow({ inspection, workflow, open_hazards: [{ _id: 'old' }, { _id: 'new' }] })
  assert.equal(draft.controls.find(row => row.hazard_id === 'old').implemented, 'yes')
  assert.equal(draft.controls.find(row => row.hazard_id === 'new').implemented, '')
  assert.equal(draft.controls.find(row => row.hazard_id === 'new').changed, '')
})


test('verified reference material seeds a new observation without auto-confirming checks', async () => {
  const { hydrateWorkflow } = await model
  const evidence = [{ type: 'record', value: '证书-01' }]
  const draft = hydrateWorkflow({ inspection, observation: null, workflow: W.emptyWorkflow(inspection), reference_suggestions: {
    certificate_checks: [{ id: 'cert-1', equipment: '压力表', reference_no: '证书-01', valid_until: '2027-01-01', result_code: 'normal', verification: 'unchanged', evidence }],
    facilities: [{ code: 'expansion', present: 'yes', name: '实际膨胀补偿设施', result_code: 'normal' }, { code: 'rupture_disc', present: 'no' }]
  } })
  assert.equal(draft.certificate_checks[0].reference_no, '证书-01')
  assert.deepEqual(draft.certificate_checks[0].evidence, evidence)
  assert.equal(draft.certificate_checks[0].result_code, '')
  assert.equal(draft.certificate_checks[0].verification, '')
  assert.equal(draft.certificate_scope_confirmed, false)
  assert.equal(draft.facilities[0].present, 'yes')
  assert.equal(draft.facilities[0].result_code, '')
  assert.equal(draft.facilities[1].present, 'no')
  assert.equal(draft.facilities[2].present, '')
})

test('explicit no-change batch confirmation excludes expired, changed, missing, abnormal, and incomplete certificates', async () => {
  const { confirmUnchangedCertificates } = await model
  const base = { equipment: '压力表', reference_no: '证书-01', valid_until: '2027-01-01', evidence: [{ type: 'record', value: '证书-01' }], result_code: '', verification: '' }
  const rows = [base, { ...base, valid_until: '2026-01-01' }, { ...base, verification: 'changed' }, { ...base, verification: 'missing' }, { ...base, result_code: 'abnormal' }, { ...base, evidence: [] }, { ...base, valid_until: '2027-02-31' }]
  assert.equal(confirmUnchangedCertificates(rows, '2026-10-16'), 1)
  assert.equal(rows[0].result_code, 'normal')
  assert.ok(rows.slice(1).every(row => row.result_code !== 'normal'))
})

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const P = require('../uniCloud-alipay/cloudfunctions/crm-safety-management/policy')
const policy = require('../uniCloud-alipay/cloudfunctions/crm-safety-management/inspectionPolicyLocal')
const { createService } = require('../uniCloud-alipay/cloudfunctions/crm-safety-management/service')
const clone = value => JSON.parse(JSON.stringify(value))
const schemas = new Map()
function validateSchema(value, schema, at = '') {
  if (!schema) return
  if (schema.enum) assert.ok(schema.enum.some(entry => JSON.stringify(entry) === JSON.stringify(value)), `${at}: invalid enum ${value}`)
  const types = Array.isArray(schema.bsonType) ? schema.bsonType : [schema.bsonType].filter(Boolean)
  const matches = type => ({ string: typeof value === 'string', number: typeof value === 'number' && Number.isFinite(value), int: Number.isInteger(value), long: Number.isInteger(value), bool: typeof value === 'boolean', boolean: typeof value === 'boolean', array: Array.isArray(value), object: value !== null && typeof value === 'object' && !Array.isArray(value), null: value === null, timestamp: typeof value === 'number' })[type]
  if (types.length) assert.ok(types.some(matches), `${at}: expected ${types}, received ${JSON.stringify(value)}`)
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) assert.ok(Object.hasOwn(value, key), `${at}: missing ${key}`)
    for (const [key, entry] of Object.entries(value)) { if (schema.additionalProperties === false) assert.ok(Object.hasOwn(schema.properties || {}, key), `${at}: unknown ${key}`); if (schema.properties?.[key]) validateSchema(entry, schema.properties[key], `${at}.${key}`) }
  }
  if (Array.isArray(value) && schema.items) value.forEach((entry, index) => validateSchema(entry, schema.items, `${at}[${index}]`))
}
function validateDocument(collection, value) {
  if (!collection.startsWith('crm_safety_') && collection !== 'crm_station_safety_hazards') return
  if (!schemas.has(collection)) { const file = path.join(root, 'uniCloud-alipay/database', `${collection}.schema.json`); schemas.set(collection, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null) }
  validateSchema(value, schemas.get(collection), collection)
}
function createDatabase(seed = {}) {
  const rootState = { tables: clone(seed), version: 0 }; let generated = 0; const reads = []
  function scoped(state, transactional = false) {
    const database = {
      command: { push: items => ({ $push: items }) },
      collection(name) {
        function query(filter = {}, offset = 0, size = Infinity, order = null, docId = '') {
          const table = () => state.tables[name] || (state.tables[name] = [])
          const matches = row => Object.entries(filter).every(([key, value]) => row[key] === value)
          return {
            where: where => query(where, offset, size, order, docId), skip: value => query(filter, value, size, order, docId), limit: value => query(filter, offset, value, order, docId), orderBy: (key, direction) => query(filter, offset, size, [key, direction], docId), doc: id => query({ _id: id }, offset, size, order, id),
            async get() { reads.push({ name, offset, size }); let result = table().filter(matches); if (order) result = [...result].sort((a, b) => String(a[order[0]]).localeCompare(String(b[order[0]])) * (order[1] === 'asc' ? 1 : -1)); const selected = clone(result.slice(offset, offset + size)); if (transactional && docId) { if (!selected.length) throw new Error('document not found'); return { data: selected[0] } } return { data: selected } },
            async add(value) { const row = { ...clone(value), _id: value._id || `generated_${++generated}` }; if (table().some(entry => entry._id === row._id)) throw new Error('duplicate key'); validateDocument(name, row); table().push(row); state.version++; return { id: row._id } },
            async update(patch) { let updated = 0; for (const row of table().filter(matches)) { const next = clone(row); for (const [key, value] of Object.entries(patch)) next[key] = value && Object.hasOwn(value, '$push') ? [...(next[key] || []), ...clone(value.$push)] : clone(value); validateDocument(name, next); Object.assign(row, next); updated++ } state.version++; return { updated } },
            async count() { return { total: table().filter(matches).length } }
          }
        }
        return query()
      },
      async startTransaction() { const expected = state.version; const local = { tables: clone(state.tables), version: state.version }; const transaction = scoped(local, true); transaction.commit = async () => { if (state.version !== expected) { const error = new Error('transaction conflict'); error.code = 409; throw error } state.tables = local.tables; state.version++ }; transaction.rollback = async () => {}; return transaction }
    }
    if (!transactional) { database.rows = collection => clone(state.tables[collection] || []); database.replace = (collection, rows) => { state.tables[collection] = clone(rows); state.version++ }; database.reads = reads }
    return database
  }
  return scoped(rootState)
}
const allPages = ['home', 'daily', 'weekly', 'monthly', 'settings', 'print'].map(page => `/pages/safety-management/${page}`)
function makeUser(id, pages = allPages) { return { _id: id, username: id, nickname: id, token: `${id}-token`, role: id === 'admin' ? 'superadmin' : 'safety_inspector', pages } }
const acl = {
  isSuperAdmin: user => user.role === 'superadmin',
  async ensureActionAcl(user, action, rules, admins = []) { if (admins.includes(action) && user.role !== 'superadmin') return { ok: false, code: 403, msg: '仅管理员' }; if (!rules[action]) return { ok: false, code: 403, msg: '未授权 action' }; return user.role === 'superadmin' || rules[action].some(rule => user.pages?.includes(rule.pagePath)) ? { ok: true } : { ok: false, code: 403, msg: '页面权限不足' } }
}
function inspection(date, id = 'inspection_1', changes = {}) {
  const items = policy.templateItems(policy.TEMPLATE).map(({ area, item }) => ({ area_code: area.code, area_label_snapshot: area.label, item_code: item.code, item_label_snapshot: item.label, category_code: P.ITEM_CATEGORY[item.code], result_code: 'normal', is_abnormal: false, photo_file_ids: [], issue_note: '' }))
  return { _id: id, station_id: P.STATION.id, station_name_snapshot: P.STATION.name, template_code: policy.TEMPLATE.code, template_version: policy.TEMPLATE.version, inspection_no: id, inspection_date: date, inspection_at: P.atDate(date) + 10 * 3600000, started_at: P.atDate(date) + 9 * 3600000, ended_at: P.atDate(date) + 10 * 3600000, weather: '晴', inspector_name: '安全员', revision: 1, updated_at: 1, items, ...changes }
}
function supplementItems() { return P.SUPPLEMENT_DEFINITIONS.map(def => ({ code: def.code, result_code: def.allowed_results.includes('not_conducted') ? 'not_conducted' : def.code === 'S12' || def.code === 'S14' ? 'not_applicable' : 'normal', reason: '当日未开展或无适用设备及未结问题', note: '', evidence: [], hazard_ids: [], details: {} })) }
function createHarness({ date = '2026-10-15', seed = {}, now = P.atDate(date) + 15 * 3600000 } = {}) {
  const config = { _id: P.identity('config', P.STATION.id, ''), station_id: P.STATION.id, station_name: P.STATION.name, enabled_from: '2026-10-01', roles: { safety_officer: ['officer'], safety_director: ['director'], principal: ['principal'] }, special_equipment: [], revision: 1 }
  const database = createDatabase({ crm_users: [makeUser('admin'), makeUser('officer'), makeUser('director'), makeUser('principal'), makeUser('outsider')], crm_safety_management_config: [config], crm_station_safety_inspections: [inspection(date)], ...seed })
  let currentTime = now
  const service = createService({ database, acl, clock: () => currentTime })
  const call = (action, data = {}, user = 'officer') => service.main({ action, token: `${user}-token`, data })
  return { database, service, call, date, config, tick: amount => { currentTime += amount }, now: () => currentTime }
}
module.exports = { createDatabase, createHarness, makeUser, inspection, supplementItems, validateSchema, validateDocument, acl }

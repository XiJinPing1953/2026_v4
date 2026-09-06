'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { checkProjectContext } = require('./checkProjectContext.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-context-check-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const put = (relative, body) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    fs.writeFileSync(path.join(root, relative), body)
  }
  const active = ['AGENTS.md', 'README.md', 'CLAUDE.md', 'STATE.md', 'docs/RULES.md', 'docs/ACCOUNTING.md', 'state/INDEX.md', 'state/domains/flow.md']
  for (const relative of active) put(relative, '# Current\n')
  put('state/INDEX.md', '[flow](domains/flow.md)\n')
  put('state/history/INDEX.md', '[old](old.md)\n')
  const historical = Buffer.from('# Historical\nSTATE must be append-only.\n[obsolete instruction link](missing-file.md)\n')
  put('state/history/old.md', historical)
  put('state/context-manifest.json', JSON.stringify({ schema_version: 1, active_documents: active }))
  put('state/history/manifest.json', JSON.stringify({ schema_version: 1, archives: [{ path: 'state/history/old.md', sha256: crypto.createHash('sha256').update(historical).digest('hex'), bytes: historical.length, lines: 3 }] }))
  return { root, put, active }
}

test('历史只验证原始完整性，不把旧规则和旧链接加载为当前指令', (t) => {
  const { root } = fixture(t)
  assert.equal(checkProjectContext(root).ok, true)
})

test('同长度原文被改也因 SHA-256 不符失败', (t) => {
  const { root, put } = fixture(t)
  const changed = fs.readFileSync(path.join(root, 'state/history/old.md'), 'utf8').replace('Historical', 'historical')
  put('state/history/old.md', changed)
  const result = checkProjectContext(root)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /SHA-256/)
})

test('归档截断同时检出字节数和行数改变', (t) => {
  const { root, put } = fixture(t)
  put('state/history/old.md', '# Truncated\n')
  assert.match(checkProjectContext(root).errors.join('\n'), /字节数、行数/)
})

test('当前入口断链与未索引领域都会阻止通过', (t) => {
  const { root, put } = fixture(t)
  put('AGENTS.md', '[missing](docs/missing.md)\n')
  put('state/INDEX.md', '# Missing domain route\n')
  const result = checkProjectContext(root)
  assert.match(result.errors.join('\n'), /链接失效/)
  assert.match(result.errors.join('\n'), /领域文件未进入当前索引/)
})

test('STATE 允许更新但超过 150 行失败', (t) => {
  const { root, put } = fixture(t)
  put('STATE.md', 'current\n'.repeat(150))
  assert.equal(checkProjectContext(root).ok, true)
  put('STATE.md', 'current\n'.repeat(151))
  assert.match(checkProjectContext(root).errors.join('\n'), /STATE 超过 150 行/)
})

test('历史注册为当前指令或当前链接逃离仓库时失败', (t) => {
  const { root, put, active } = fixture(t)
  put('state/context-manifest.json', JSON.stringify({ schema_version: 1, active_documents: [...active, 'state/history/old.md'] }))
  put('README.md', '[external](../outside.md)\n')
  const result = checkProjectContext(root)
  assert.match(result.errors.join('\n'), /历史资料不能注册为当前指令/)
  assert.match(result.errors.join('\n'), /路径越出仓库/)
})

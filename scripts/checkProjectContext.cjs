#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const REQUIRED_CURRENT = ['AGENTS.md', 'README.md', 'CLAUDE.md', 'STATE.md', 'docs/RULES.md', 'docs/ACCOUNTING.md', 'state/INDEX.md']

function countLines(bytes) {
  const text = bytes.toString('utf8')
  if (!text) return 0
  return text.split(/\r\n|\n|\r/).length - (/\r\n$|[\r\n]$/.test(text) ? 1 : 0)
}

function localLinks(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)]
    .map((match) => match[1] || match[2])
    .filter((target) => !target.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .map((target) => decodeURIComponent(target.split('#')[0]))
    .filter(Boolean)
}

function checkProjectContext(root) {
  const errors = []
  const stats = { active_documents: 0, local_links: 0, verified_archives: 0, state_lines: 0 }
  const resolveLocal = (relative) => {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error(`仓库路径无效: ${relative}`)
    const full = path.resolve(root, relative)
    const fromRoot = path.relative(path.resolve(root), full)
    if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`)) throw new Error(`路径越出仓库: ${relative}`)
    return full
  }
  const readJson = (relative) => JSON.parse(fs.readFileSync(resolveLocal(relative), 'utf8'))
  let manifest
  try { manifest = readJson('state/context-manifest.json') } catch (error) {
    return { ok: false, errors: [`无法读取当前上下文清单: ${error.message}`], stats }
  }
  const active = manifest.active_documents
  if (manifest.schema_version !== 1 || !Array.isArray(active)) {
    return { ok: false, errors: ['上下文清单版本或 active_documents 无效'], stats }
  }
  const uniqueActive = new Set(active)
  if (uniqueActive.size !== active.length) errors.push('当前上下文清单包含重复文档')
  for (const required of REQUIRED_CURRENT) {
    if (!uniqueActive.has(required)) errors.push(`缺少当前入口: ${required}`)
  }
  for (const relative of active) {
    try {
      if (/^state\/history\//.test(relative) || /^state\/PHASE_/.test(relative)) {
        errors.push(`历史资料不能注册为当前指令: ${relative}`)
        continue
      }
      const full = resolveLocal(relative)
      const bytes = fs.readFileSync(full)
      stats.active_documents++
      if (relative === 'STATE.md') {
        stats.state_lines = countLines(bytes)
        if (stats.state_lines > 150) errors.push(`STATE 超过 150 行: ${stats.state_lines}`)
      }
      for (const target of localLinks(bytes.toString('utf8'))) {
        stats.local_links++
        const repoRelative = path.relative(root, path.resolve(path.dirname(full), target))
        const linked = resolveLocal(repoRelative)
        if (!fs.existsSync(linked)) errors.push(`链接失效: ${relative} → ${target}`)
      }
    } catch (error) { errors.push(`当前文档 ${relative}: ${error.message}`) }
  }
  // Validate the archive as bytes. Never load historical text as current instructions.
  try {
    const archived = readJson('state/history/manifest.json')
    if (archived.schema_version !== 1 || !Array.isArray(archived.archives) || !archived.archives.length) {
      errors.push('归档清单为空或版本无效')
    } else {
      const seen = new Set()
      for (const record of archived.archives) {
        if (seen.has(record.path)) { errors.push(`归档记录重复: ${record.path}`); continue }
        seen.add(record.path)
        if (!/^state\/history\//.test(record.path || '')) { errors.push(`归档路径不属于历史目录: ${record.path}`); continue }
        const bytes = fs.readFileSync(resolveLocal(record.path))
        const hash = crypto.createHash('sha256').update(bytes).digest('hex')
        const mismatches = []
        if (hash !== record.sha256) mismatches.push('SHA-256')
        if (bytes.length !== record.bytes) mismatches.push('字节数')
        if (countLines(bytes) !== record.lines) mismatches.push('行数')
        if (mismatches.length) errors.push(`归档完整性失败 (${mismatches.join('、')}): ${record.path}`)
        else stats.verified_archives++
      }
      const index = fs.readFileSync(resolveLocal('state/history/INDEX.md'), 'utf8')
      for (const target of localLinks(index)) {
        const linked = resolveLocal(path.posix.join('state/history', target))
        if (!fs.existsSync(linked)) errors.push(`历史索引链接失效: ${target}`)
      }
    }
  } catch (error) { errors.push(`归档检查: ${error.message}`) }
  try {
    const index = fs.readFileSync(resolveLocal('state/INDEX.md'), 'utf8')
    const indexed = new Set(localLinks(index).map((target) => path.posix.normalize(path.posix.join('state', target))))
    for (const relative of active.filter((value) => value.startsWith('state/domains/'))) {
      if (!indexed.has(relative)) errors.push(`领域文件未进入当前索引: ${relative}`)
    }
  } catch (error) { errors.push(`领域索引检查: ${error.message}`) }
  return { ok: errors.length === 0, errors, stats }
}

if (require.main === module) {
  const result = checkProjectContext(path.resolve(__dirname, '..'))
  if (result.ok) console.log(`上下文检查通过：${result.stats.active_documents} 份当前资料，STATE ${result.stats.state_lines} 行，${result.stats.verified_archives} 份归档完整。`)
  else for (const error of result.errors) console.error(error)
  process.exitCode = result.ok ? 0 : 1
}

module.exports = { checkProjectContext, countLines, localLinks }

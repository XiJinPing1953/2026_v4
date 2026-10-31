#!/usr/bin/env node
'use strict'
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process')
function summarize(events) {
 const pages = new Map()
 for (const event of events) {
  if (event.kind === 'page_start') pages.set(event.page_id, { session: event.session, page_id: event.page_id, route: event.route, visit: event.visit, source: event.source, stages_ms: {}, local_spans: [], cloud_calls: [] })
  const page = pages.get(event.page_id)
  if (!page) continue
  if (event.kind === 'page_stage') page.stages_ms[event.stage] = event.elapsed_ms
  if (event.kind === 'local_span') page.local_spans.push({ stage: event.stage, duration_ms: event.duration_ms })
  if (event.kind === 'cloud') page.cloud_calls.push({ name: event.name, action: event.action, request_id: event.request_id, roundtrip_ms: event.elapsed_ms,
   code: event.code, function_ms: event.server?.function_ms ?? null, db_wall_ms: event.server?.db?.wall_ms ?? null,
   db_sum_ms: event.server?.db?.sum_ms ?? null, db_count: event.server?.db?.count ?? null,
   first_instance_invocation: event.server?.first_instance_invocation ?? null, database_reads: event.server?.db?.calls || [] })
 }
 return { generated_at: new Date().toISOString(), semantics: 'page visit=1 means first entry in this capture session, not confirmed OS/app or server cold start; database SDK round trips; parallel phases are not additive', pages: [...pages.values()] }
}
function main(args) {
 const options = Object.fromEntries(args.map(arg => { const index = arg.indexOf('='); if (index < 0) throw Error('Use --name=value'); return [arg.slice(0, index), arg.slice(index + 1)] }))
 if (options['--input']) { const events = fs.readFileSync(options['--input'], 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); const result = summarize(events); fs.writeFileSync(options['--out'], JSON.stringify(result, null, 2) + '\n'); return }
 const duration = Number(options['--seconds'] || 120)
 if (!options['--out'] || !options['--device'] || !Number.isInteger(duration) || duration < 1 || duration > 600) throw Error('Required --device=... --out=...; --seconds=1..600')
 fs.mkdirSync(path.dirname(path.resolve(options['--out'])), { recursive: true })
 const output = fs.createWriteStream(options['--out'], { flags: 'wx', mode: 0o600 }), events = [], fragments = new Map()
 const adb = options['--adb'] || 'adb'
 const child = spawn(adb, ['-s', options['--device'], 'logcat', '-T', '1', '-v', 'raw', '-s', 'CRM_PERF:I', '*:S'], { stdio: ['ignore', 'pipe', 'pipe'] })
 let pending = '', finished = false
 function line(value) {
  const match = value.match(/^part (perf_[a-zA-Z0-9_-]+:\d+) (\d+)\/(\d+) (.*)$/)
  if (!match) return
  const [, id, index, total, text] = match
  if (Number(total) > 50 || Number(index) < 1 || Number(index) > Number(total)) return
  if (fragments.size > 200) fragments.delete(fragments.keys().next().value)
  if (!fragments.has(id)) fragments.set(id, { total: Number(total), parts: [] })
  const group = fragments.get(id); group.parts[Number(index) - 1] = text
  if (group.parts.filter(x => typeof x === 'string').length !== group.total) return
  fragments.delete(id)
  try { const event = JSON.parse(group.parts.join('')); if (event.schema !== 1 || !event.session?.startsWith('perf_')) return; events.push(event); output.write(JSON.stringify(event) + '\n'); if (['page_start', 'page_stage', 'cloud'].includes(event.kind)) console.log(JSON.stringify({ kind: event.kind, route: event.route, stage: event.stage, elapsed_ms: event.elapsed_ms, action: event.action })) } catch (_) { console.error('Incomplete or invalid timing record') }
 }
 child.stdout.on('data', chunk => { pending += chunk.toString(); const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(line) })
 child.stderr.on('data', chunk => process.stderr.write(chunk))
 child.on('error', error => { console.error(error.message); process.exitCode = 1 })
 const timer = setTimeout(() => child.kill('SIGTERM'), duration * 1000)
 function finish() { if (finished) return; finished = true; clearTimeout(timer); output.end(); fs.writeFileSync(options['--out'] + '.summary.json', JSON.stringify(summarize(events), null, 2) + '\n'); console.log(JSON.stringify({ events: events.length, incomplete_fragments: fragments.size, output: options['--out'] })); if (!events.length) process.exitCode = 2 }
 child.on('close', finish)
 process.on('SIGINT', () => child.kill('SIGTERM'))
}
module.exports = { summarize }
if (require.main === module) { try { main(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 } }

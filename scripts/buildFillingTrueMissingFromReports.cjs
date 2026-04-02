#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_MISSING = 'docs/filling.hhh.missing.details.json'
const DEFAULT_CONFLICTS = 'docs/filling.hhh.conflicts15.details.json'
const DEFAULT_OUTPUT = 'docs/filling.hhh.true_missing_51.json'

function parseArgs(argv) {
	const args = {
		missing: DEFAULT_MISSING,
		conflicts: DEFAULT_CONFLICTS,
		output: DEFAULT_OUTPUT
	}
	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if ((cur === '--missing' || cur === '-m') && next) {
			args.missing = next
			i += 1
		} else if ((cur === '--conflicts' || cur === '-c') && next) {
			args.conflicts = next
			i += 1
		} else if ((cur === '--output' || cur === '-o') && next) {
			args.output = next
			i += 1
		} else if (cur === '--help' || cur === '-h') {
			console.log(`
Usage:
  node scripts/buildFillingTrueMissingFromReports.cjs [options]

Options:
  --missing, -m <path>     missing details json (default ${DEFAULT_MISSING})
  --conflicts, -c <path>   conflicts json (default ${DEFAULT_CONFLICTS})
  --output, -o <path>      output json (default ${DEFAULT_OUTPUT})
`)
			process.exit(0)
		}
	}
	return args
}

function ensureDir(filePath) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function normalizeText(value) {
	if (value == null) return ''
	return String(value).trim()
}

function asPositiveLineNo(value) {
	const n = Number(value)
	if (!Number.isFinite(n)) return 0
	const out = Math.floor(n)
	return out > 0 ? out : 0
}

function main() {
	const args = parseArgs(process.argv)
	const missingPath = path.resolve(process.cwd(), args.missing)
	const conflictsPath = path.resolve(process.cwd(), args.conflicts)
	const outputPath = path.resolve(process.cwd(), args.output)

	if (!fs.existsSync(missingPath)) throw new Error(`missing 文件不存在: ${missingPath}`)
	if (!fs.existsSync(conflictsPath)) throw new Error(`conflicts 文件不存在: ${conflictsPath}`)

	const missingJson = JSON.parse(fs.readFileSync(missingPath, 'utf8'))
	const conflictsJson = JSON.parse(fs.readFileSync(conflictsPath, 'utf8'))
	const missingRows = Array.isArray(missingJson.missing_sample) ? missingJson.missing_sample : []
	const conflictRows = Array.isArray(conflictsJson.conflicts) ? conflictsJson.conflicts : []

	const conflictLineSet = new Set(
		conflictRows
			.map((row) => asPositiveLineNo(row && row.line_no))
			.filter((n) => n > 0)
	)

	const outputRows = missingRows
		.filter((row) => !conflictLineSet.has(asPositiveLineNo(row && row.line_no)))
		.map((row) => ({
			line_no: asPositiveLineNo(row && row.line_no),
			date: normalizeText(row && row.date),
			record_type: normalizeText(row && row.record_type) || 'normal_fill',
			bottle_no: normalizeText(row && row.bottle_no),
			fill_weight: Number(row && row.fill_weight),
			operator: normalizeText(row && row.operator) || '陈铁栓',
			remark: normalizeText(row && row.remark)
		}))

	ensureDir(outputPath)
	fs.writeFileSync(outputPath, `${JSON.stringify(outputRows, null, 2)}\n`, 'utf8')

	console.log(
		JSON.stringify(
			{
				missing_total: missingRows.length,
				conflict_total: conflictRows.length,
				output_total: outputRows.length,
				output: outputPath
			},
			null,
			2
		)
	)
}

main()

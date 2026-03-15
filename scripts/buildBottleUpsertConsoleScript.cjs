#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_INPUT = 'uniCloud-alipay/database/crm_bottles.init_data.json'
const DEFAULT_OUTPUT = 'docs/test0314.upsert.by_bottle_no.js'
const UPDATE_FIELDS = [
	'bottle_no',
	'filling_company',
	'registration_mark',
	'equipment_type',
	'product_no',
	'qr_code',
	'manufacturer',
	'volume_l',
	'manufacture_date',
	'bottle_check_date',
	'bottle_next_check_date',
	'bottle_check_cycle_months',
	'scrap_due_date',
	'pressure_gauge_no',
	'pressure_gauge_manufacturer',
	'pressure_gauge_range_min',
	'pressure_gauge_range_max',
	'pressure_gauge_check_date',
	'pressure_gauge_next_check_date',
	'pressure_gauge_cycle_months',
	'safety_valve_count',
	'safety_valve_check_date',
	'safety_valve_next_check_date',
	'safety_valve_cycle_months',
	'tare_weight'
]

function parseArgs(argv) {
	const args = {
		input: DEFAULT_INPUT,
		output: DEFAULT_OUTPUT
	}

	for (let i = 2; i < argv.length; i += 1) {
		const cur = argv[i]
		const next = argv[i + 1]
		if (cur === '--input' && next) {
			args.input = next
			i += 1
		} else if (cur === '--output' && next) {
			args.output = next
			i += 1
		} else if (cur === '--help' || cur === '-h') {
			console.log(`
Usage:
  node scripts/buildBottleUpsertConsoleScript.cjs [options]

Options:
  --input <path>    Source JSON (default: ${DEFAULT_INPUT})
  --output <path>   Output JS script (default: ${DEFAULT_OUTPUT})
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

function sanitizeForUpsert(records) {
	return records.map((row) => {
		const out = {}
		UPDATE_FIELDS.forEach((key) => {
			if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key]
		})
		return out
	})
}

function buildConsoleScript(records, batchRemark) {
	const payload = JSON.stringify(records, null, 2)
	return `/**
 * 云数据库控制台脚本（按 bottle_no 覆盖更新）
 * 空间：env-00jxuffegf2n
 *
 * 安全默认：
 * - DRY_RUN = true 先试跑不落库
 * - ALLOW_CREATE = false 不新增，只更新已有瓶号
 * - SAVE_BACKUP = true 执行前备份原始文档（可用于回滚）
 */

const DRY_RUN = true
const ALLOW_CREATE = false
const SAVE_BACKUP = true
const BACKUP_COLLECTION = 'crm_bottles_import_backups'
const BATCH_REMARK = ${JSON.stringify(batchRemark || '')}

const records = ${payload}

async function run() {
  const col = db.collection('crm_bottles')
  const backupCol = db.collection(BACKUP_COLLECTION)
  const dbCmd = db.command
  const summary = {
    total: records.length,
    matched: 0,
    updated: 0,
    created: 0,
    missing: [],
    duplicated_bottle_no: [],
    backed_up: 0,
    backup_failed: [],
    failed: []
  }

  for (let i = 0; i < records.length; i += 1) {
    const item = records[i]
    try {
      const foundRes = await col.where({ bottle_no: item.bottle_no }).get()
      const found = (foundRes && foundRes.data) || []

      if (found.length === 1) {
        summary.matched += 1
        if (!DRY_RUN) {
          if (SAVE_BACKUP) {
            try {
              await backupCol.add({
                batch_remark: BATCH_REMARK || 'upsert:unknown',
                bottle_no: item.bottle_no,
                source_collection: 'crm_bottles',
                source_id: found[0]._id,
                backup_doc: found[0],
                backed_up_at: Date.now()
              })
              summary.backed_up += 1
            } catch (backupErr) {
              summary.backup_failed.push({
                bottle_no: item.bottle_no,
                error: backupErr && backupErr.message ? backupErr.message : String(backupErr)
              })
              continue
            }
          }

          await col.doc(found[0]._id).update({
            ...item,
            bottle_check_fee: dbCmd.remove(),
            pressure_gauge_check_fee: dbCmd.remove(),
            safety_valve_check_fee: dbCmd.remove(),
            updated_at: Date.now(),
            ...(BATCH_REMARK ? { remark: BATCH_REMARK + ':upsert' } : {})
          })
        }
        summary.updated += 1
        continue
      }

      if (found.length === 0) {
        summary.missing.push(item.bottle_no)
        if (ALLOW_CREATE && !DRY_RUN) {
          await col.add({
            ...item,
            created_at: Date.now(),
            updated_at: Date.now(),
            remark: BATCH_REMARK ? BATCH_REMARK + ':upsert:create' : ''
          })
          summary.created += 1
        }
        continue
      }

      summary.duplicated_bottle_no.push(item.bottle_no)
    } catch (err) {
      summary.failed.push({
        bottle_no: item.bottle_no,
        error: err && err.message ? err.message : String(err)
      })
    }
  }

  summary.missing = summary.missing.slice(0, 30)
  summary.duplicated_bottle_no = summary.duplicated_bottle_no.slice(0, 30)
  summary.backup_failed = summary.backup_failed.slice(0, 30)
  summary.failed = summary.failed.slice(0, 30)
  return summary
}

run()
`
}

function main() {
	const args = parseArgs(process.argv)
	const inputPath = path.resolve(process.cwd(), args.input)
	const outputPath = path.resolve(process.cwd(), args.output)

	if (!fs.existsSync(inputPath)) throw new Error(`输入文件不存在: ${inputPath}`)

	const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
	if (!Array.isArray(source) || source.length === 0) throw new Error('输入 JSON 为空或非数组')

	const batchRemark = source[0] && source[0].remark ? String(source[0].remark) : ''
	const records = sanitizeForUpsert(source)
	const scriptText = buildConsoleScript(records, batchRemark)

	ensureDir(outputPath)
	fs.writeFileSync(outputPath, scriptText, 'utf8')

	console.log(`生成成功: ${outputPath}`)
	console.log(`- records: ${records.length}`)
	console.log(`- batch:   ${batchRemark || '(empty)'}`)
}

try {
	main()
} catch (err) {
	console.error(`执行失败: ${err.message}`)
	process.exit(1)
}

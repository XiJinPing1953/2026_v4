#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const QRCode = require('../node_modules/qrcode-terminal/vendor/QRCode')
const QRErrorCorrectLevel = require('../node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel')
const { loadTableRows, normalizeString } = require('./lib/qrImportCommon.cjs')

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'docs/pilot-qrcodes')
const PRESETS = {
	large: {
		name: 'large',
		outputDir: DEFAULT_OUTPUT_DIR,
		svgWidth: 1200,
		svgHeight: 1520,
		qrBoxSize: 860,
		quietZone: 4,
		qrOffsetY: 160,
		frameInset: 40,
		frameRadius: 36,
		frameStrokeWidth: 8,
		titleY: 150,
		titleFontSize: 52,
		subtitleY: 90,
		subtitleFontSize: 34,
		codeY: 1110,
		codeFontSize: 44,
		labelY: 1180,
		labelFontSize: 30,
		footerY: 1450,
		footerFontSize: 28,
		printPagePaddingMm: 10,
		printTitleSizePt: 20,
		printBodySizePt: 10,
		printGridColumns: 2,
		printGapMm: 8,
		printCardPaddingMm: 4,
		printTitleMetaSizePt: 11,
		printCodeMetaSizePt: 9
	},
	small: {
		name: 'small',
		outputDir: path.resolve(process.cwd(), 'docs/pilot-qrcodes-small'),
		svgWidth: 840,
		svgHeight: 1040,
		qrBoxSize: 540,
		quietZone: 4,
		qrOffsetY: 125,
		frameInset: 28,
		frameRadius: 24,
		frameStrokeWidth: 6,
		titleY: 112,
		titleFontSize: 36,
		subtitleY: 68,
		subtitleFontSize: 22,
		codeY: 760,
		codeFontSize: 26,
		labelY: 812,
		labelFontSize: 20,
		footerY: 968,
		footerFontSize: 18,
		printPagePaddingMm: 8,
		printTitleSizePt: 16,
		printBodySizePt: 8.5,
		printGridColumns: 3,
		printGapMm: 4,
		printCardPaddingMm: 2.5,
		printTitleMetaSizePt: 9,
		printCodeMetaSizePt: 7
	},
	'300': {
		name: '300',
		outputDir: path.resolve(process.cwd(), 'docs/pilot-qrcodes-300'),
		svgWidth: 300,
		svgHeight: 300,
		qrBoxSize: 228,
		quietZone: 4,
		qrOffsetY: 42,
		frameInset: 8,
		frameRadius: 10,
		frameStrokeWidth: 2,
		titleY: 24,
		titleFontSize: 13,
		subtitleY: 34,
		subtitleFontSize: 8,
		codeY: 0,
		codeFontSize: 0,
		labelY: 0,
		labelFontSize: 0,
		footerY: 0,
		footerFontSize: 0,
		showSubtitle: false,
		showCode: false,
		showLabel: false,
		showFooter: false,
		printPagePaddingMm: 6,
		printTitleSizePt: 14,
		printBodySizePt: 8,
		printGridColumns: 5,
		printGapMm: 2.5,
		printCardPaddingMm: 1.5,
		printTitleMetaSizePt: 7.5,
		printCodeMetaSizePt: 6
	}
}

function ensureDir(dirPath) {
	if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function escapeXml(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function makeQrModules(text) {
	const qrcode = new QRCode(-1, QRErrorCorrectLevel.M)
	qrcode.addData(text)
	qrcode.make()
	return qrcode.modules
}

function parseArgs(argv) {
	const options = {
		preset: 'large',
		outputDir: null,
		customerInput: 'docs/pilot_customer_qr_codes.csv',
		bottleInput: 'docs/pilot_pda_qr_bottles.csv',
		deliveryInput: 'docs/pilot_delivery_qr_codes.csv',
		vehicleInput: 'docs/pilot_vehicle_qr_codes.csv'
	}
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index]
		if (token === '--preset') {
			options.preset = normalizeString(argv[index + 1]).toLowerCase() || options.preset
			index += 1
			continue
		}
		if (token.startsWith('--preset=')) {
			options.preset = normalizeString(token.slice('--preset='.length)).toLowerCase() || options.preset
			continue
		}
		if (token === '--out-dir') {
			options.outputDir = normalizeString(argv[index + 1]) || null
			index += 1
			continue
		}
		if (token.startsWith('--out-dir=')) {
			options.outputDir = normalizeString(token.slice('--out-dir='.length)) || null
			continue
		}
		if (token === '--customer-input') {
			options.customerInput = normalizeString(argv[index + 1]) || options.customerInput
			index += 1
			continue
		}
		if (token.startsWith('--customer-input=')) {
			options.customerInput = normalizeString(token.slice('--customer-input='.length)) || options.customerInput
			continue
		}
		if (token === '--bottle-input') {
			options.bottleInput = normalizeString(argv[index + 1]) || options.bottleInput
			index += 1
			continue
		}
		if (token.startsWith('--bottle-input=')) {
			options.bottleInput = normalizeString(token.slice('--bottle-input='.length)) || options.bottleInput
			continue
		}
		if (token === '--delivery-input') {
			options.deliveryInput = normalizeString(argv[index + 1]) || options.deliveryInput
			index += 1
			continue
		}
		if (token.startsWith('--delivery-input=')) {
			options.deliveryInput = normalizeString(token.slice('--delivery-input='.length)) || options.deliveryInput
			continue
		}
		if (token === '--vehicle-input') {
			options.vehicleInput = normalizeString(argv[index + 1]) || options.vehicleInput
			index += 1
			continue
		}
		if (token.startsWith('--vehicle-input=')) {
			options.vehicleInput = normalizeString(token.slice('--vehicle-input='.length)) || options.vehicleInput
		}
	}
	return options
}

function resolvePreset(options) {
	const preset = PRESETS[options.preset] || PRESETS.large
	return {
		...preset,
		outputDir: options.outputDir ? path.resolve(process.cwd(), options.outputDir) : preset.outputDir,
		showSubtitle: preset.showSubtitle !== false,
		showCode: preset.showCode !== false,
		showLabel: preset.showLabel !== false,
		showFooter: preset.showFooter !== false
	}
}

function renderQrRects(modules, preset) {
	const size = modules.length + preset.quietZone * 2
	const moduleSize = preset.qrBoxSize / size
	const offsetX = (preset.svgWidth - preset.qrBoxSize) / 2
	const offsetY = preset.qrOffsetY
	const rects = []
	for (let row = 0; row < modules.length; row += 1) {
		for (let col = 0; col < modules[row].length; col += 1) {
			if (!modules[row][col]) continue
			const x = offsetX + (col + preset.quietZone) * moduleSize
			const y = offsetY + (row + preset.quietZone) * moduleSize
			rects.push(
				`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${moduleSize.toFixed(2)}" height="${moduleSize.toFixed(2)}" rx="0" ry="0"/>`
			)
		}
	}
	return rects.join('\n    ')
}

function buildCardSvg({ title, subtitle = '', code, footer = '' }, preset) {
	const modules = makeQrModules(code)
	const qrRects = renderQrRects(modules, preset)
	const centerX = preset.svgWidth / 2
	const frameInset = preset.frameInset
	const subtitleLine = preset.showSubtitle && subtitle
		? `<text x="${centerX}" y="${preset.subtitleY}" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, Helvetica, Arial, sans-serif" font-size="${preset.subtitleFontSize}" fill="#4b5563">${escapeXml(subtitle)}</text>`
		: ''
	const footerLine = preset.showFooter && footer
		? `<text x="${centerX}" y="${preset.footerY}" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, Helvetica, Arial, sans-serif" font-size="${preset.footerFontSize}" fill="#6b7280">${escapeXml(footer)}</text>`
		: ''
	const codeLine = preset.showCode
		? `<text x="${centerX}" y="${preset.codeY}" text-anchor="middle" font-family="Menlo, Consolas, monospace" font-size="${preset.codeFontSize}" font-weight="700" fill="#111827">${escapeXml(code)}</text>`
		: ''
	const labelLine = preset.showLabel
		? `<text x="${centerX}" y="${preset.labelY}" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, Helvetica, Arial, sans-serif" font-size="${preset.labelFontSize}" fill="#4b5563">PDA 试点二维码</text>`
		: ''

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${preset.svgWidth} ${preset.svgHeight}" width="${preset.svgWidth}" height="${preset.svgHeight}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="${frameInset}" y="${frameInset}" width="${preset.svgWidth - frameInset * 2}" height="${preset.svgHeight - frameInset * 2}" rx="${preset.frameRadius}" ry="${preset.frameRadius}" fill="#ffffff" stroke="#111827" stroke-width="${preset.frameStrokeWidth}"/>
  <text x="${centerX}" y="${preset.titleY}" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, Helvetica, Arial, sans-serif" font-size="${preset.titleFontSize}" font-weight="700" fill="#111827">${escapeXml(title)}</text>
  ${subtitleLine}
  <rect x="${(preset.svgWidth - preset.qrBoxSize) / 2}" y="${preset.qrOffsetY}" width="${preset.qrBoxSize}" height="${preset.qrBoxSize}" fill="#ffffff"/>
  <g fill="#000000">
    ${qrRects}
  </g>
  ${codeLine}
  ${labelLine}
  ${footerLine}
</svg>
`
}

function writeTextFile(filePath, content) {
	fs.writeFileSync(filePath, content, 'utf8')
}

function readPilotItems(options = {}) {
	const items = []

	const customerRows = loadTableRows(options.customerInput || 'docs/pilot_customer_qr_codes.csv').rows
	customerRows.forEach(({ row }, index) => {
		const name = normalizeString(row.name)
		const phone = normalizeString(row.phone)
		const code = normalizeString(row.qr_code)
		items.push({
			entity: 'customer',
			sortKey: 10 + index,
			fileName: `customer-${index + 1}-${code.toLowerCase()}.svg`,
			title: name || `客户 ${index + 1}`,
			subtitle: phone ? `电话 ${phone}` : '客户试点',
			code,
			footer: '扫码回填客户'
		})
	})

	const bottleRows = loadTableRows(options.bottleInput || 'docs/pilot_pda_qr_bottles.csv').rows
	bottleRows.forEach(({ row }, index) => {
		const bottleNo = normalizeString(row.bottle_no)
		const code = normalizeString(row.pda_qr_code)
		items.push({
			entity: 'bottle',
			sortKey: 20 + index,
			fileName: `bottle-${bottleNo || index + 1}.svg`,
			title: `钢瓶 ${bottleNo}`,
			subtitle: 'PDA 扫码专用',
			code,
			footer: `瓶号 ${bottleNo}`
		})
	})

	const deliveryRows = loadTableRows(options.deliveryInput || 'docs/pilot_delivery_qr_codes.csv').rows
	deliveryRows.forEach(({ row }, index) => {
		const name = normalizeString(row.name)
		const phone = normalizeString(row.phone)
		const code = normalizeString(row.qr_code)
		items.push({
			entity: 'delivery',
			sortKey: 30 + index,
			fileName: `delivery-${index + 1}-${code.toLowerCase()}.svg`,
			title: name || `配送员 ${index + 1}`,
			subtitle: phone ? `电话 ${phone}` : '配送员试点',
			code,
			footer: '扫码回填配送员'
		})
	})

	const vehicleRows = loadTableRows(options.vehicleInput || 'docs/pilot_vehicle_qr_codes.csv').rows
	vehicleRows.forEach(({ row }, index) => {
		const plateNo = normalizeString(row.plate_no)
		const code = normalizeString(row.qr_code)
		items.push({
			entity: 'vehicle',
			sortKey: 40 + index,
			fileName: `vehicle-${index + 1}-${code.toLowerCase()}.svg`,
			title: `车辆 ${plateNo}`,
			subtitle: '车辆试点',
			code,
			footer: '扫码回填车辆'
		})
	})

	return items.sort((a, b) => a.sortKey - b.sortKey)
}

function buildPrintHtml(items, preset) {
	const presetLabel = preset.name === '300' ? '300x300 版' : preset.name === 'small' ? '小号版' : '标准版'
	const cards = items
		.map((item) => {
			return `<section class="card">
  <img src="./${encodeURI(item.fileName)}" alt="${escapeXml(item.title)}" />
  <div class="meta">
    <div class="title">${escapeXml(item.title)}</div>
    <div class="code">${escapeXml(item.code)}</div>
  </div>
</section>`
		})
		.join('\n')

	return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>PDA 试点二维码打印页</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #111827;
      background: #f3f4f6;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: ${preset.printPagePaddingMm}mm;
      background: #ffffff;
    }
    h1 {
      margin: 0 0 4mm;
      font-size: ${preset.printTitleSizePt}pt;
    }
    p {
      margin: 0 0 8mm;
      font-size: ${preset.printBodySizePt}pt;
      color: #4b5563;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(${preset.printGridColumns}, 1fr);
      gap: ${preset.printGapMm}mm;
    }
    .card {
      border: 1px solid #d1d5db;
      border-radius: 4mm;
      padding: ${preset.printCardPaddingMm}mm;
      background: #fff;
      page-break-inside: avoid;
    }
    .card img {
      display: block;
      width: 100%;
      height: auto;
    }
    .meta {
      margin-top: 2mm;
      text-align: center;
    }
    .title {
      font-size: ${preset.printTitleMetaSizePt}pt;
      font-weight: 700;
    }
    .code {
      margin-top: 1mm;
      font-family: Menlo, Consolas, monospace;
      font-size: ${preset.printCodeMetaSizePt}pt;
      color: #374151;
      word-break: break-all;
    }
    @media print {
      body { background: #fff; }
      .page { margin: 0; padding: ${Math.max(6, preset.printPagePaddingMm - 2)}mm; width: auto; min-height: auto; }
    }
  </style>
</head>
<body>
  <main class="page">
    <h1>PDA 试点二维码打印页</h1>
    <p>共 ${items.length} 张。当前为 ${presetLabel}，建议先打样后再批量打印。</p>
    <div class="grid">
${cards}
    </div>
  </main>
</body>
</html>
`
}

function buildReadme(items, preset) {
	const presetLabel = preset.name === '300' ? '300x300 版' : preset.name === 'small' ? '小号版' : '标准版'
	const lines = [
		'# PDA 试点二维码文件',
		'',
		`本目录包含 ${items.length} 个试点对象的可打印 SVG 二维码，以及一个 A4 打印页。当前版本：${presetLabel}。`,
		'',
		'## 文件列表'
	]
	items.forEach((item) => {
		lines.push(`- ${item.fileName} -> ${item.title} -> ${item.code}`)
	})
	lines.push('', '## 打印建议', '- 打开 `print.html` 直接浏览器打印。', '- 贴码前先用 PDA 实扫验证当前扫码链路。')
	if (preset.name === 'small' || preset.name === '300') {
		lines.push('- 当前是紧凑版贴标，正式扩面前建议先做一轮打样。')
	}
	return `${lines.join('\n')}\n`
}

function main() {
	const options = parseArgs(process.argv.slice(2))
	const preset = resolvePreset(options)
	ensureDir(preset.outputDir)
	const items = readPilotItems(options)
	items.forEach((item) => {
		const svg = buildCardSvg(item, preset)
		writeTextFile(path.join(preset.outputDir, item.fileName), svg)
	})
	writeTextFile(path.join(preset.outputDir, 'print.html'), buildPrintHtml(items, preset))
	writeTextFile(path.join(preset.outputDir, 'README.md'), buildReadme(items, preset))
	console.log(JSON.stringify({
		preset: preset.name,
		out_dir: preset.outputDir,
		total: items.length,
		files: items.map((item) => item.fileName)
	}, null, 2))
}

main()

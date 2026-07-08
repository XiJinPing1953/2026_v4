#!/usr/bin/env node
'use strict'

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const repoRoot = path.resolve(__dirname, '..')
const outDir = path.join(repoRoot, 'outputs', 'industrial-trace-demo-video')
const audioFile = path.join(outDir, 'voiceover.wav')
const outputBase = path.join(outDir, 'industrial-cylinder-trace-demo')
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const width = 1920
const height = 1080

const scenes = [
	{
		key: 'opening',
		start: 0,
		end: 25,
		title: '工业气瓶全流程追溯与经营管理系统',
		subtitle: '真实业务驱动追溯，追溯反哺经营管理',
		focus: ['面向工业气体企业', '不是独立扫码台账', '基于真实经营业务形成追溯链'],
		screen: 'trace-map'
	},
	{
		key: 'dashboard',
		start: 25,
		end: 60,
		title: '工作台总览',
		subtitle: '经营数据与追溯风险同屏可见',
		focus: ['异常监控', '检验到期', '本月销售', '在户资产', '在站库存', '储罐监控', '业务日报', 'RFID 盘点入口'],
		screen: 'dashboard'
	},
	{
		key: 'sale',
		start: 60,
		end: 105,
		title: '气瓶真实业务流转',
		subtitle: '每一张销售单都是追溯链上的事件',
		focus: ['客户', '配送员', '车辆', '出瓶', '回瓶', '存瓶', '销售底单', '收款结算'],
		screen: 'sale'
	},
	{
		key: 'filling',
		start: 105,
		end: 145,
		title: '灌装与气瓶状态',
		subtitle: '回瓶、灌装、出瓶形成闭环',
		focus: ['灌装记录', 'PDA 灌装看板', '工位任务', '目标重量', '当前重量', '确认完成'],
		screen: 'filling'
	},
	{
		key: 'timeline',
		start: 145,
		end: 185,
		title: '单瓶追溯与异常识别',
		subtitle: '输入瓶号查看完整生命周期',
		focus: ['出站时间', '送达客户', '回站记录', '灌装记录', '缺回瓶', '缺灌装', '连续出瓶'],
		screen: 'timeline'
	},
	{
		key: 'rfid',
		start: 185,
		end: 225,
		title: 'RFID 门口自动盘点',
		subtitle: '自动形成车辆盘点会话，辅助现场校验',
		focus: ['正常会话', '车辆冲突', '无车辆', '瓶子 EPC', '读取次数', '未绑定标签', '未知标签'],
		screen: 'rfid'
	},
	{
		key: 'pda',
		start: 225,
		end: 265,
		title: 'PDA 现场作业',
		subtitle: '一线扫码、称重、销售直接沉淀追溯数据',
		focus: ['钢瓶查询', '客户查询', '销售录入', '扫码瓶号', 'BLE 吊秤称重'],
		screen: 'pda'
	},
	{
		key: 'statement',
		start: 265,
		end: 300,
		title: '客户对账与经营闭环',
		subtitle: '气瓶流转对应客户、销售和收款',
		focus: ['应收余额', '可抵扣余额', '净欠款', '预付/冲抵', '导出对账单', '财务报表'],
		screen: 'statement'
	},
	{
		key: 'closing',
		start: 300,
		end: 320,
		title: '真实业务驱动追溯',
		subtitle: '追溯反哺经营管理',
		focus: ['管钢瓶', '控风险', '查异常', '做对账'],
		screen: 'closing'
	}
]

function html() {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>工业气瓶追溯系统演示视频</title>
<style>
html, body { margin: 0; width: 100%; height: 100%; background: #07111f; overflow: hidden; }
canvas { width: 100vw; height: 100vh; display: block; }
#status { position: fixed; left: 16px; bottom: 16px; color: #dbeafe; font: 14px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
</style>
</head>
<body>
<canvas id="stage" width="${width}" height="${height}"></canvas>
<audio id="audio" src="/voiceover.wav" preload="auto"></audio>
<div id="status">Preparing...</div>
<script>
const scenes = ${JSON.stringify(scenes)};
const plannedTotal = ${scenes[scenes.length - 1].end};
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const audio = document.getElementById('audio');
const statusEl = document.getElementById('status');
const W = canvas.width;
const H = canvas.height;
const preferredTypes = [
	'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
	'video/mp4',
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm'
];

function pickMimeType() {
	for (const type of preferredTypes) {
		if (MediaRecorder.isTypeSupported(type)) return type;
	}
	return '';
}

function sceneAt(t) {
	const planned = Math.min(plannedTotal - 0.001, Math.max(0, t));
	return scenes.find((scene) => planned >= scene.start && planned < scene.end) || scenes[scenes.length - 1];
}

function ease(v) {
	v = Math.max(0, Math.min(1, v));
	return v * v * (3 - 2 * v);
}

function roundedRect(x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

function fillRound(x, y, w, h, r, fill, stroke) {
	roundedRect(x, y, w, h, r);
	ctx.fillStyle = fill;
	ctx.fill();
	if (stroke) {
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 2;
		ctx.stroke();
	}
}

function text(value, x, y, size, color, weight = 500, align = 'left') {
	ctx.font = weight + ' ' + size + 'px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
	ctx.fillStyle = color;
	ctx.textAlign = align;
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(value, x, y);
}

function wrapText(value, x, y, maxWidth, lineHeight, size, color, weight = 500) {
	const chars = Array.from(value);
	let line = '';
	let cursorY = y;
	ctx.font = weight + ' ' + size + 'px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
	ctx.fillStyle = color;
	for (const ch of chars) {
		const next = line + ch;
		if (ctx.measureText(next).width > maxWidth && line) {
			ctx.fillText(line, x, cursorY);
			line = ch;
			cursorY += lineHeight;
		} else {
			line = next;
		}
	}
	if (line) ctx.fillText(line, x, cursorY);
	return cursorY;
}

function background(t) {
	const grd = ctx.createLinearGradient(0, 0, W, H);
	grd.addColorStop(0, '#07111f');
	grd.addColorStop(0.48, '#0f2537');
	grd.addColorStop(1, '#12343c');
	ctx.fillStyle = grd;
	ctx.fillRect(0, 0, W, H);
	ctx.globalAlpha = 0.22;
	ctx.strokeStyle = '#6ee7b7';
	ctx.lineWidth = 1;
	for (let i = -10; i < 36; i++) {
		const x = i * 84 + (t * 12) % 84;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x - 520, H);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
}

function drawHeader(scene, plannedTime) {
	text('新拓能源 · 工业气瓶追溯', 82, 76, 28, '#9cc7ff', 700);
	const progress = plannedTime / plannedTotal;
	fillRound(82, 96, W - 164, 8, 4, 'rgba(148,163,184,.28)');
	fillRound(82, 96, (W - 164) * progress, 8, 4, '#4ade80');
	text(formatTime(plannedTime) + ' / ' + formatTime(plannedTotal), W - 82, 78, 22, '#cbd5e1', 500, 'right');
}

function formatTime(sec) {
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function drawFocus(scene) {
	text('本段重点', 94, 302, 30, '#e2e8f0', 800);
	scene.focus.forEach((item, i) => {
		const x = 94 + (i % 2) * 310;
		const y = 346 + Math.floor(i / 2) * 76;
		fillRound(x, y, 270, 48, 12, 'rgba(15, 23, 42, .76)', 'rgba(148, 163, 184, .32)');
		ctx.fillStyle = ['#60a5fa', '#34d399', '#fbbf24', '#f87171'][i % 4];
		ctx.beginPath();
		ctx.arc(x + 28, y + 24, 7, 0, Math.PI * 2);
		ctx.fill();
		text(item, x + 48, y + 32, 22, '#f8fafc', 700);
	});
}

function drawTraceMap(t) {
	const nodes = [
		['回瓶', 980, 290], ['灌装', 1230, 230], ['出瓶', 1490, 320],
		['客户', 1470, 590], ['对账', 1210, 700], ['盘点', 960, 610]
	];
	ctx.strokeStyle = '#38bdf8';
	ctx.lineWidth = 5;
	ctx.setLineDash([16, 18]);
	ctx.beginPath();
	for (let i = 0; i < nodes.length; i++) {
		const [, x, y] = nodes[i];
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
	ctx.stroke();
	ctx.setLineDash([]);
	nodes.forEach(([label, x, y], i) => {
		const pulse = 1 + Math.sin(t * 3 + i) * 0.04;
		fillRound(x - 82 * pulse, y - 44 * pulse, 164 * pulse, 88 * pulse, 24, 'rgba(15, 23, 42, .88)', '#60a5fa');
		text(label, x, y + 12, 32, '#f8fafc', 800, 'center');
	});
}

function drawDashboard() {
	const labels = ['异常监控', '检验到期', '本月销售', '在户资产', '在站库存'];
	labels.forEach((label, i) => {
		const x = 830 + i * 198;
		fillRound(x, 210, 170, 142, 18, '#f8fafc', 'rgba(15,23,42,.14)');
		text(label, x + 18, 250, 24, '#334155', 700);
		text(['12', '8', '¥86k', '428', '236'][i], x + 18, 318, 42, ['#ef4444', '#f59e0b', '#2563eb', '#059669', '#0f766e'][i], 900);
	});
	fillRound(840, 410, 420, 300, 18, '#f8fafc');
	text('储罐监控', 880, 468, 30, '#0f172a', 800);
	fillRound(930, 510, 150, 150, 18, '#e2e8f0', '#94a3b8');
	fillRound(930, 575, 150, 85, 18, '#60a5fa');
	text('液位 58%', 1120, 580, 32, '#0369a1', 800);
	text('压力稳定', 1120, 630, 26, '#059669', 700);
	fillRound(1310, 410, 430, 300, 18, '#f8fafc');
	text('业务日报', 1350, 468, 30, '#0f172a', 800);
	['充装瓶数', '销售重量', '客户数', '导出报表'].forEach((v, i) => text(v, 1360, 530 + i * 46, 24, '#475569', 600));
}

function drawSale() {
	fillRound(850, 180, 840, 620, 18, '#f8fafc');
	text('新建销售单', 900, 240, 34, '#0f172a', 900);
	const fields = ['客户：华丰项目部', '配送员：张师傅 / 李师傅', '车辆：冀A406RB', '出瓶：J71 / J76', '回瓶：J45', '存瓶：2 瓶', '底单图片：已上传', '收款结算：待对账'];
	fields.forEach((item, i) => {
		const x = 900 + (i % 2) * 370;
		const y = 300 + Math.floor(i / 2) * 96;
		fillRound(x, y, 320, 60, 12, '#eef6ff', '#c7ddff');
		text(item, x + 18, y + 38, 23, '#1e293b', 700);
	});
	fillRound(1030, 700, 470, 54, 16, '#2563eb');
	text('业务录单即追溯采集', 1265, 737, 26, '#ffffff', 800, 'center');
}

function drawFilling() {
	['空闲', '写入中', '待启动', '充装中', '已到量', '异常'].forEach((label, i) => {
		const x = 860 + i * 138;
		fillRound(x, 190, 112, 92, 16, i === 3 ? '#dbeafe' : '#f8fafc', '#cbd5e1');
		text(label, x + 56, 226, 22, '#334155', 700, 'center');
		text(String([2,1,1,3,1,0][i]), x + 56, 266, 32, '#2563eb', 900, 'center');
	});
	[0,1,2].forEach((i) => {
		const y = 350 + i * 150;
		fillRound(900, y, 720, 112, 18, '#f8fafc', '#cbd5e1');
		text('工位 ' + (i + 1), 940, y + 45, 28, '#0f172a', 900);
		text(['瓶号 J71 · 已充 42.5 / 目标 45.0 kg', '瓶号 J76 · 等待启动 C606+', '瓶号 J45 · 已到目标，等待确认'][i], 940, y + 86, 24, '#475569', 600);
		fillRound(1410, y + 28, 160, 54, 16, i === 2 ? '#16a34a' : '#2563eb');
		text(i === 2 ? '确认完成' : '查看任务', 1490, y + 64, 22, '#fff', 800, 'center');
	});
}

function drawTimeline() {
	fillRound(890, 180, 780, 650, 18, '#f8fafc');
	text('单瓶时间线 · J71', 940, 238, 34, '#0f172a', 900);
	const rows = [
		['2026-06-18', '回瓶', '客户返回站内', '#0284c7'],
		['2026-06-18', '灌装', '净重 42.5 kg', '#16a34a'],
		['2026-06-19', '出瓶', '送达华丰项目部', '#2563eb'],
		['当前', '异常检测', '无待处理异常', '#f59e0b']
	];
	rows.forEach((row, i) => {
		const y = 310 + i * 112;
		ctx.strokeStyle = '#cbd5e1';
		ctx.lineWidth = 4;
		if (i < rows.length - 1) {
			ctx.beginPath();
			ctx.moveTo(990, y + 26);
			ctx.lineTo(990, y + 118);
			ctx.stroke();
		}
		ctx.fillStyle = row[3];
		ctx.beginPath();
		ctx.arc(990, y + 24, 15, 0, Math.PI * 2);
		ctx.fill();
		text(row[0] + ' · ' + row[1], 1030, y + 22, 26, '#0f172a', 800);
		text(row[2], 1030, y + 62, 23, '#64748b', 600);
	});
}

function drawRfid() {
	fillRound(845, 170, 860, 660, 18, '#f8fafc');
	text('RFID 门口盘点', 895, 230, 34, '#0f172a', 900);
	['筛选结果 18', '正常会话 12', '车辆冲突 2', '无车辆 4'].forEach((item, i) => {
		fillRound(900 + i * 190, 270, 164, 80, 16, i === 2 ? '#fef2f2' : '#eef6ff', '#cbd5e1');
		text(item, 982 + i * 190, 320, 22, i === 2 ? '#dc2626' : '#1e40af', 800, 'center');
	});
	fillRound(920, 410, 720, 280, 18, '#f8fafc', '#cbd5e1');
	text('会话 rfid-gate-main · 冀A406RB', 960, 460, 28, '#0f172a', 900);
	['车辆标签：已绑定', '瓶子 EPC：J71 · 读取 4 次', '瓶子 EPC：J76 · 读取 3 次', '未知标签：1 个，待核查'].forEach((item, i) => {
		text(item, 980, 520 + i * 44, 24, i === 3 ? '#dc2626' : '#334155', 700);
	});
	fillRound(1010, 725, 540, 54, 16, '#0f766e');
	text('用于盘点校验，不自动生成销售单', 1280, 761, 24, '#fff', 800, 'center');
}

function drawPda() {
	fillRound(1040, 155, 400, 720, 38, '#111827', '#334155');
	fillRound(1070, 205, 340, 610, 24, '#f8fafc');
	text('PDA 工作台', 1240, 260, 28, '#0f172a', 900, 'center');
	['钢瓶查询', '客户查询', '灌装看板', '销售录入'].forEach((item, i) => {
		fillRound(1102 + (i % 2) * 154, 320 + Math.floor(i / 2) * 132, 126, 92, 16, '#e0f2fe', '#bae6fd');
		text(item, 1165 + (i % 2) * 154, 374 + Math.floor(i / 2) * 132, 22, '#075985', 800, 'center');
	});
	fillRound(1115, 615, 250, 88, 16, '#dcfce7', '#86efac');
	text('BLE 吊秤', 1240, 653, 24, '#166534', 900, 'center');
	text('当前重量 42.5 kg', 1240, 686, 20, '#166534', 700, 'center');
}

function drawStatement() {
	fillRound(850, 175, 850, 650, 18, '#f8fafc');
	text('客户对账与财务闭环', 900, 235, 34, '#0f172a', 900);
	['应收余额', '可抵扣余额', '净欠款', '最近回款'].forEach((label, i) => {
		fillRound(910 + i * 190, 280, 162, 104, 16, '#eef6ff', '#c7ddff');
		text(label, 991 + i * 190, 318, 21, '#334155', 700, 'center');
		text(['¥12,800', '¥2,000', '¥10,800', '06-28'][i], 991 + i * 190, 360, 26, '#2563eb', 900, 'center');
	});
	['客户', '销售单', '收款/冲抵', '对账单', '财务报表'].forEach((label, i) => {
		const x = 930 + i * 145;
		const y = 540;
		fillRound(x, y, 115, 72, 16, '#ecfdf5', '#bbf7d0');
		text(label, x + 58, y + 45, 20, '#166534', 800, 'center');
		if (i < 4) {
			text('→', x + 132, y + 45, 34, '#64748b', 800, 'center');
		}
	});
}

function drawClosing() {
	drawTraceMap(0);
	fillRound(820, 760, 850, 92, 24, 'rgba(15,23,42,.82)', '#4ade80');
	text('真实业务驱动追溯，追溯反哺经营管理', 1245, 818, 36, '#f8fafc', 900, 'center');
}

function drawScreen(scene, t) {
	if (scene.screen === 'trace-map') drawTraceMap(t);
	if (scene.screen === 'dashboard') drawDashboard();
	if (scene.screen === 'sale') drawSale();
	if (scene.screen === 'filling') drawFilling();
	if (scene.screen === 'timeline') drawTimeline();
	if (scene.screen === 'rfid') drawRfid();
	if (scene.screen === 'pda') drawPda();
	if (scene.screen === 'statement') drawStatement();
	if (scene.screen === 'closing') drawClosing();
}

function drawCaption(scene, localProgress) {
	fillRound(82, H - 150, W - 164, 92, 22, 'rgba(15,23,42,.84)', 'rgba(148,163,184,.32)');
	text(scene.subtitle, W / 2, H - 92, 34, '#f8fafc', 900, 'center');
}

function draw() {
	const duration = Number.isFinite(audio.duration) && audio.duration > 1 ? audio.duration : plannedTotal;
	const plannedTime = Math.min(plannedTotal, (audio.currentTime || 0) * plannedTotal / duration);
	const scene = sceneAt(plannedTime);
	const localProgress = ease((plannedTime - scene.start) / Math.max(1, scene.end - scene.start));
	background(plannedTime);
	drawHeader(scene, plannedTime);
	text(scene.title, 86, 190, scene.key === 'opening' ? 62 : 54, '#f8fafc', 900);
	wrapText(scene.subtitle, 90, 245, 650, 42, 30, '#bae6fd', 800);
	drawFocus(scene);
	drawScreen(scene, plannedTime);
	drawCaption(scene, localProgress);
	statusEl.textContent = 'Recording ' + formatTime(plannedTime) + ' / ' + formatTime(plannedTotal);
	requestAnimationFrame(draw);
}

async function uploadBlob(blob, extension) {
	const res = await fetch('/upload?ext=' + encodeURIComponent(extension), {
		method: 'POST',
		headers: { 'Content-Type': 'application/octet-stream' },
		body: blob
	});
	if (!res.ok) throw new Error('upload failed: ' + res.status);
}

async function start() {
	await audio.play();
	audio.pause();
	audio.currentTime = 0;
	const canvasStream = canvas.captureStream(30);
	const audioContext = new AudioContext();
	const source = audioContext.createMediaElementSource(audio);
	const dest = audioContext.createMediaStreamDestination();
	source.connect(dest);
	source.connect(audioContext.destination);
	for (const track of dest.stream.getAudioTracks()) canvasStream.addTrack(track);
	const mimeType = pickMimeType();
	const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType, videoBitsPerSecond: 6500000, audioBitsPerSecond: 128000 } : undefined);
	const chunks = [];
	recorder.ondataavailable = (event) => {
		if (event.data && event.data.size) chunks.push(event.data);
	};
	recorder.onstop = async () => {
		const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' });
		const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
		statusEl.textContent = 'Uploading ' + Math.round(blob.size / 1024 / 1024) + ' MB...';
		await uploadBlob(blob, ext);
		statusEl.textContent = 'Done';
	};
	recorder.start(1000);
	await audio.play();
	audio.onended = () => {
		setTimeout(() => recorder.stop(), 500);
	};
	draw();
}

window.addEventListener('load', () => {
	setTimeout(() => start().catch((err) => {
		console.error(err);
		statusEl.textContent = String(err && err.message || err);
	}), 600);
});
</script>
</body>
</html>`
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getJson(url) {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`)
	return res.json()
}

async function main() {
	if (!fs.existsSync(audioFile)) {
		throw new Error(`Missing audio file: ${audioFile}`)
	}
	fs.mkdirSync(outDir, { recursive: true })
	let uploadedFile = ''
	const server = http.createServer((req, res) => {
		if (req.url === '/' || req.url.startsWith('/index.html')) {
			const body = html()
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
			res.end(body)
			return
		}
		if (req.url === '/voiceover.wav') {
			res.writeHead(200, { 'Content-Type': 'audio/wav' })
			fs.createReadStream(audioFile).pipe(res)
			return
		}
		if (req.url.startsWith('/upload')) {
			const url = new URL(req.url, 'http://127.0.0.1')
			const ext = url.searchParams.get('ext') === 'mp4' ? 'mp4' : 'webm'
			uploadedFile = `${outputBase}.${ext}`
			const ws = fs.createWriteStream(uploadedFile)
			req.pipe(ws)
			ws.on('finish', () => {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true, file: uploadedFile }))
				setTimeout(() => server.close(), 1000)
			})
			return
		}
		res.writeHead(404)
		res.end('not found')
	})
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = server.address().port
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-demo-chrome-'))
	const chrome = spawn(chromePath, [
		'--headless=new',
		'--autoplay-policy=no-user-gesture-required',
		'--disable-gpu',
		'--mute-audio=false',
		'--remote-debugging-port=0',
		`--user-data-dir=${userDataDir}`,
		`http://127.0.0.1:${port}/index.html`
	], { stdio: ['ignore', 'pipe', 'pipe'] })
	chrome.stdout.on('data', (chunk) => process.stdout.write(chunk))
	chrome.stderr.on('data', (chunk) => process.stderr.write(chunk))

	const timeoutAt = Date.now() + 12 * 60 * 1000
	while (!uploadedFile && Date.now() < timeoutAt) await wait(1000)
	if (!uploadedFile) throw new Error('Timed out waiting for browser recording upload')
	chrome.kill('SIGTERM')
	try {
		const version = await getJson(`http://127.0.0.1:${port}/json/version`)
		void version
	} catch (_) {
		// Chrome is expected to be closed by now.
	}
	console.log(uploadedFile)
}

main().catch((err) => {
	console.error(err && err.stack ? err.stack : err)
	process.exit(1)
})

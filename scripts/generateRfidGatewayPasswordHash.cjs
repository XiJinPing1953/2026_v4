#!/usr/bin/env node
'use strict'

const crypto = require('crypto')

function usage() {
	console.log(`Usage:
  node scripts/generateRfidGatewayPasswordHash.cjs <password>
  RFID_GATEWAY_PASSWORD=your-password node scripts/generateRfidGatewayPasswordHash.cjs

Output:
  Copy the generated value into the uniCloud environment variable RFID_GATEWAY_PASSWORD_HASH.
`)
}

function normalizeString(value) {
	if (value == null) return ''
	return String(value).trim()
}

function generatePasswordHash(password) {
	const iterations = 120000
	const salt = crypto.randomBytes(16).toString('hex')
	const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex')
	return `pbkdf2-sha256$${iterations}$${salt}$${hash}`
}

const password = normalizeString(process.argv[2]) || normalizeString(process.env.RFID_GATEWAY_PASSWORD)

if (!password || password === '--help' || password === '-h') {
	usage()
	process.exit(password ? 0 : 1)
}

console.log(generatePasswordHash(password))

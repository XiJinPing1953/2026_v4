#!/usr/bin/env node
'use strict'

const crypto = require('crypto')

function normalizeString(value) {
	return value == null ? '' : String(value).trim()
}

function generatePasswordHash(password) {
	const iterations = 120000
	const salt = crypto.randomBytes(16).toString('hex')
	const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex')
	return `pbkdf2-sha256$${iterations}$${salt}$${hash}`
}

const password = normalizeString(process.argv[2]) || normalizeString(process.env.FILLING_PERMIT_GATEWAY_PASSWORD)

if (!password || password === '--help' || password === '-h') {
	console.log(`Usage:
  node scripts/generateFillingPermitGatewayPasswordHash.cjs <password>
  FILLING_PERMIT_GATEWAY_PASSWORD=your-password node scripts/generateFillingPermitGatewayPasswordHash.cjs

Copy the output into FILLING_PERMIT_GATEWAY_PASSWORD_HASH.
Create a separate random FILLING_PERMIT_GATEWAY_TOKEN_SECRET (at least 32 bytes).
`)
	process.exit(password ? 0 : 1)
}

console.log(generatePasswordHash(password))

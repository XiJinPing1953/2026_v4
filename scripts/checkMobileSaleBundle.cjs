'use strict'
// Check the real uni-app output: development module loading can hide invalid
// dynamic import paths and a missing software decoder in a production build.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const assets = path.resolve(__dirname, '../dist/build/h5/assets')
const files = fs.readdirSync(assets).filter(name => name.endsWith('.js'))
const sale = files.find(name => name.startsWith('pages-pda-sale-create.'))
assert.ok(sale, 'Build H5 before checking the mobile sale bundle')
const source = fs.readFileSync(path.join(assets, sale), 'utf8')
assert.match(source, /new Worker/, 'Software decoder worker must be locally bundled')
assert.match(source, /BarcodeDetector/, 'Native decoder capability detection must be retained')
assert.match(source, /Camera not found/, 'Camera scanner must be included in the sale page bundle')
for (const file of files) {
  const code = fs.readFileSync(path.join(assets, file), 'utf8')
  assert.doesNotMatch(code, /import\(["']\.\.-node_modules/, `${file}: invalid bare dynamic module path`)
}
console.log('Mobile sale H5 bundle: camera + native/software decoder present; no invalid dependency imports.')

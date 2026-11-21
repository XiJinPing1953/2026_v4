// Materialize the Android application key only in a separate packaging directory.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const source = path.resolve(__dirname, '../src/manifest.json')
const destination = process.argv[2] && path.resolve(process.argv[2], 'src/manifest.json')
assert(destination && fs.realpathSync(destination) !== fs.realpathSync(source), '请指定独立的打包目录')
const template = fs.readFileSync(source, 'utf8')
assert.equal(fs.readFileSync(destination, 'utf8'), template, '打包目录的清单与源码不一致')
const key = process.env.AMAP_ANDROID_KEY?.trim()
assert(/^[a-f0-9]{32}$/i.test(key || ''), '需要有效的 AMAP_ANDROID_KEY')
const marker = '__AMAP_ANDROID_KEY__'
assert.equal(template.split(marker).length, 2, '清单缺少唯一的 Android Key 注入位置')
fs.writeFileSync(destination, template.replace(marker, key))

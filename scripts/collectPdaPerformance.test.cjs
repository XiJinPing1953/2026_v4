const test = require('node:test'), assert = require('node:assert/strict')
test('collector preserves first-render timing when a later manual query repeats the stage', () => {
 const { summarize } = require('./collectPdaPerformance.cjs')
 const result = summarize([{kind:'page_start',page_id:'p',at:1000},{kind:'page_stage',page_id:'p',stage:'records_ready',elapsed_ms:220},{kind:'page_stage',page_id:'p',stage:'records_ready',elapsed_ms:9800}])
 assert.equal(result.pages[0].stages_ms.records_ready,220)
 assert.deepEqual(result.pages[0].stage_occurrences.map(x=>x.elapsed_ms),[220,9800])
})

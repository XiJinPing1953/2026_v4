'use strict'

// Source weights allow 0.001 kg. Preserve grams in the tonne ledger;
// round to 0.001 t only when presenting an aggregate to the user.
function inventoryTon(value) {
 const number = Number(value)
 if (!Number.isFinite(number)) throw new Error('库存重量无效')
 return Math.round(number * 1e6) / 1e6
}
function kgToTon(value) {
 const number = Number(value)
 return Number.isFinite(number) ? inventoryTon(number / 1000) : null
}
module.exports = { inventoryTon, kgToTon }

// Native bridge stand-in with the actual EscCommand signatures/byte framing.
const iconv = require('iconv-lite')
const ADDRESS = '00:11:22:33:AA:21'
function receiptPrinterHarness({ missing = '', connected = true, address = ADDRESS } = {}) {
 const sends = [], operations = [], buffers = [], manager = {}
 const android = {
  newObject(name) { if (missing === 'class') return null; if (name !== 'com.smart.command.EscCommand') throw Error(name); const buffer=[];buffers.push(buffer);return {buffer} },
  invoke(target, method, ...args) {
   if (method === missing) return undefined
   if (method === 'getDeviceConnFactoryManager') return manager
   if (target === manager) {
    if (method === 'getConnState') return connected
    if (method === 'getMacAddress') return address
    if (method === 'sendDataImmediately') { sends.push([...args[0]]); return }
   }
   if (Array.isArray(target) && method === 'size') return target.length
   if (method === 'getCommand') return target.buffer
   operations.push([method,...args])
   const n=args[0], short=[n&255,(n>>8)&255]
   const bytes={addInitializePrinter:[27,64],addSelectKanjiMode:[28,38],addSetHorAndVerMotionUnits:[29,80,...args.map(x=>x&255)],addSetLeftMargin:[29,76,...short],addSetPrintingAreaWidth:[29,87,...short],addSetAbsolutePrintPosition:[27,36,...short],addPrintAndFeedPaper:[27,74,n],addText:method==='addText'?[...iconv.encode(n,'gb2312')]:[]}[method]
   if (!bytes) throw Error(method)
   target.buffer.push(...bytes)
  }
 }
 return { android, sends, operations, buffers, address:ADDRESS, disconnect(){connected=false}, changeAddress(value){address=value} }
}
module.exports = { receiptPrinterHarness, ADDRESS }

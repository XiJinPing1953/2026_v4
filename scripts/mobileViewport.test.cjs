const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('src/components/base/AppBottleQueryFloat.vue', 'utf8')
const functions = source.slice(source.indexOf('function clamp('), source.indexOf('function openPanel('))
function harness(width, height, visualHeight = height) {
 const context = {Math, Number, DRAG_EDGE_GAP:8, metrics:{}, triggerPosition:{x:1000,y:1000}, panelPosition:{x:1000,y:1000},
  uni:{getSystemInfoSync:()=>({windowWidth:width,windowHeight:height}),upx2px:n=>n*width/750},
  window:{innerWidth:width,innerHeight:height,visualViewport:{width,height:visualHeight},document:{documentElement:{clientWidth:width,clientHeight:height}}}}
 vm.createContext(context); vm.runInContext(functions+';initMetrics();',context); return context
}
test('floating bottle query stays inside 320px mobile and landscape viewports',()=>{
 for(const [w,h] of [[320,568],[360,640],[390,844],[430,932],[767,360]]) {
  const c=harness(w,h)
  assert.equal(c.metrics.windowWidth,w);assert.equal(c.metrics.windowHeight,h)
  assert.ok(c.panelPosition.x+c.metrics.panelWidth<=w)
  assert.ok(c.panelPosition.y+c.metrics.panelHeight<=h)
  assert.ok(c.triggerPosition.x+c.metrics.triggerSize<=w)
  assert.ok(c.triggerPosition.y+c.metrics.triggerSize<=h)
 }
})
test('keyboard resize uses visual viewport and clamps an already open panel',()=>{
 const c=harness(390,844)
 c.window.visualViewport.height=300
 vm.runInContext('initMetrics({preservePosition:true})',c)
 assert.equal(c.metrics.windowHeight,300)
 assert.ok(c.panelPosition.y+c.metrics.panelHeight<=300)
 assert.ok(c.triggerPosition.y+c.metrics.triggerSize<=300)
})
test('missing visualViewport uses actual window size, not a minimum device size',()=>{
 const c=harness(320,568);delete c.window.visualViewport
 vm.runInContext('initMetrics({preservePosition:true})',c)
 assert.equal(c.metrics.windowWidth,320);assert.equal(c.metrics.windowHeight,568)
})

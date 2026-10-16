import fs from 'node:fs'
import path from 'node:path'
export default function statementPreview() {
 const root = process.cwd()
 return { name: 'local-statement-preview', enforce: 'pre',
  configResolved(config) { if(config.command !== 'serve') throw Error('Statement preview is development-only; refusing preview production build') },
  transformIndexHtml(html) { return process.env.SAFETY_PREVIEW === '1' ? html.replace('</body>', '<div class="safety-local-preview-note">本地示例预览 · 所有填写仅存于浏览器内存 · 未启用真实台账</div><style>.safety-local-preview-note{position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:5px 10px;background:#fef3c7;color:#78350f;font:12px/1.5 sans-serif;text-align:center;pointer-events:none}@media print{.safety-local-preview-note{display:none}}</style></body>') : html },
  configureServer(server) { server.middlewares.use((req,res,next)=>{res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:* ws://localhost:*; form-action 'none'"); next()}) },
  transform(code,id) {
   const file=id.split('?')[0].replaceAll('\\','/')
   if(id.includes('?')) return
   if(file.endsWith('/src/services/api/callCloud.js')) return `export { callCloud } from '/preview/${process.env.SAFETY_PREVIEW === '1' ? 'safety' : process.env.MOBILE_PREVIEW === '1' ? 'mobile' : 'statement'}/mock.mjs'; export const getQueryEpoch=()=>0;`
   if(file.endsWith('/src/services/auth.js')) return `const user={_id:'preview-user',name:'本地模拟用户',role:'superadmin',role_template:'superadmin',status:'active'}; export const getUser=()=>user;export const getToken=()=>'';export const setToken=()=>{};export const setUser=()=>{};export const clearAuth=()=>{};export const getRoleTemplate=()=> 'superadmin';export const isLoggedIn=()=>true;export const syncCurrentUser=async()=>({code:0,user});`
   if(file.endsWith('/src/App.vue')) return `<script>import '@dcloudio/uni-h5/style/picker.css'; import '@dcloudio/uni-components/style/picker-view.css'; import '@dcloudio/uni-components/style/picker-view-column.css'; export default {}</script>${code.slice(code.indexOf('<style'))}`
   if(file.endsWith('/src/pages/customer/statement.vue')) return fs.readFileSync(path.join(root,'preview/statement/Preview.vue'),'utf8')
   if(file.endsWith('/src/pages/cashier/receipt-intake.vue')) return fs.readFileSync(path.join(root,'preview/statement/CashierPreview.vue'),'utf8')
  }
 }
}

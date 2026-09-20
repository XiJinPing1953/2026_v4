import fs from 'node:fs'
import path from 'node:path'
export default function statementPreview() {
 const root = process.cwd()
 return { name: 'local-statement-preview', enforce: 'pre',
  configResolved(config) { if(config.command !== 'serve') throw Error('Statement preview is development-only; refusing preview production build') },
  configureServer(server) { server.middlewares.use((req,res,next)=>{res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:* ws://localhost:*; form-action 'none'"); next()}) },
  transform(code,id) {
   const file=id.split('?')[0].replaceAll('\\','/')
   if(id.includes('?')) return
   if(file.endsWith('/src/services/api/callCloud.js')) return `export { callCloud } from '/preview/statement/mock.mjs'`
   if(file.endsWith('/src/services/auth.js')) return `const user={_id:'preview-user',name:'本地模拟用户',role:'superadmin',role_template:'superadmin',status:'active'}; export const getUser=()=>user;export const getToken=()=>'';export const setToken=()=>{};export const setUser=()=>{};export const clearAuth=()=>{};export const getRoleTemplate=()=> 'superadmin';export const isLoggedIn=()=>true;export const syncCurrentUser=async()=>({code:0,user});`
   if(file.endsWith('/src/App.vue')) return `<script>export default {}</script><style lang="scss">@import "@/uni.scss";page {background:var(--crm-bg);color:var(--crm-text)}</style>`
   if(file.endsWith('/src/pages/customer/statement.vue')) return fs.readFileSync(path.join(root,'preview/statement/Preview.vue'),'utf8')
   if(file.endsWith('/src/pages/cashier/receipt-intake.vue')) return fs.readFileSync(path.join(root,'preview/statement/CashierPreview.vue'),'utf8')
  }
 }
}

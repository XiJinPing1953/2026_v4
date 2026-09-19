import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import statementPreview from './preview/statement/plugin.mjs'

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [...(process.env.STATEMENT_PREVIEW === '1' ? [statementPreview()] : []), uni()]
})

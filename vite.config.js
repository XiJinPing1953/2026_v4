import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [uni()],
	css: {
		preprocessorOptions: {
			scss: {
				// Silence Dart Sass deprecation warnings emitted by HBuilderX toolchain.
				silenceDeprecations: ['legacy-js-api', 'import']
			}
		}
	}
})

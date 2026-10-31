import {
	createSSRApp
} from "vue";
import App from "./App.vue";
import { installPerformanceTrace } from './services/performanceTrace';
export function createApp() {
	const app = createSSRApp(App);
	installPerformanceTrace(app);
	return {
		app,
	};
}

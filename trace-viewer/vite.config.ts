import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
	plugins: [
		solidPlugin(),
		tailwindcss(),
		VitePWA({
			srcDir: "src/services/serviceWorker",
			filename: "sw.ts",
			strategies: "injectManifest",
			injectRegister: false,
			manifest: false,
			injectManifest: {
				injectionPoint: undefined,
			},
			devOptions: {
				enabled: true,
				type: "module",
			},
		}),
	],
	resolve: {
		alias: {
			"@": "/src",
		},
	},
	server: {
		port: 3000,
	},
	build: {
		target: "esnext",
	},
});

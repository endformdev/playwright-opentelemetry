import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
	base: getBasePath(),
	plugins: [
		solidPlugin(),
		tailwindcss(),
		VitePWA({
			srcDir: "src/service-worker",
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
		port: 9294,
	},
	build: {
		target: "esnext",
	},
});

function getBasePath(): string {
	const base = process.env.VITE_TRACE_VIEWER_BASE ?? "/";
	return base.endsWith("/") ? base : `${base}/`;
}

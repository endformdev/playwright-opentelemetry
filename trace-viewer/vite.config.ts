import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
	plugins: [solidPlugin(), tailwindcss()],
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
		rollupOptions: {
			input: {
				main: "index.html",
				sw: "src/services/serviceWorker/sw.ts",
			},
			output: {
				entryFileNames: (chunkInfo) => {
					// Service worker needs to be at root level
					if (chunkInfo.name === "sw") {
						return "sw.js";
					}
					return "assets/[name]-[hash].js";
				},
			},
		},
	},
});

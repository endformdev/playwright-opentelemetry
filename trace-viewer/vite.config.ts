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
	},
});

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
	base: getBasePath(),
	plugins: [solidPlugin(), tailwindcss()],
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

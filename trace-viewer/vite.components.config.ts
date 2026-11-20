import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
	plugins: [solidPlugin(), tailwindcss()],
	publicDir: false,
	build: {
		target: "esnext",
		outDir: "lib",
		lib: {
			entry: "src/components.ts",
			formats: ["es"],
			fileName: "components",
			cssFileName: "components",
		},
		rolldownOptions: {
			external: [/^solid-js(\/|$)/],
		},
	},
});

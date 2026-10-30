import { defineConfig } from "tsdown";

export default defineConfig({
	dts: {
		sourcemap: true,
	},
	entry: {
		index: "./src/index",
		"cloudflare-live": "./src/cloudflare-live/index",
	},
	exports: true,
});

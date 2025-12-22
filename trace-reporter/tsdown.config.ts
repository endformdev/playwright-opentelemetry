import { defineConfig } from "tsdown";

export default defineConfig({
	dts: {
		sourcemap: false,
	},
	entry: {
		reporter: "./src/reporter",
		fixture: "./src/fixture",
	},
});

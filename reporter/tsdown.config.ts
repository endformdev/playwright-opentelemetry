import { defineConfig } from "tsdown";

export default defineConfig({
	dts: {
		sourcemap: false,
	},
	entry: {
		index: "./src/index",
		reporter: "./src/reporter",
		fixture: "./src/fixture",
		"fixture/factory": "./src/fixture/factory",
	},
	fixedExtension: true,
	format: ["esm", "cjs"],
});

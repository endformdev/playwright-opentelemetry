import { defineConfig } from "tsdown";

export default defineConfig({
	dts: true,
	entry: {
		reporter: "./src/reporter",
		fixture: "./src/fixture",
	},
});

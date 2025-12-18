import { defineConfig } from "tsdown";

export default defineConfig({
	dts: true,
	entry: {
		reporter: "./src/reporter-entry.ts",
		fixture: "./src/fixture-entry.ts",
	},
});

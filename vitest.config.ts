import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: [
			"reporter/test-unit/**/*.test.ts",
			"trace-viewer/src/**/*.{test,spec}.{ts,tsx}",
			"trace-api/src/**/*.{test,spec}.{ts,tsx}",
		],
	},
});

// import { defineConfig } from "vitest/config";

// export default defineConfig({
//   test: {
//     env: {
//       TZ: "UTC",
//     },
//     projects: [
//       "reporter",
// 	  "trace-viewer",
//     ],
//   },
// });

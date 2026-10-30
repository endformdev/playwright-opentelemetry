import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";

/** The live trace Worker in test-e2e/live-trace-worker, run by wrangler dev. */
const LIVE_TRACE_API_URL = "http://localhost:9296";

test("streams a running test into the viewer as it happens", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const traceIdFile = test.info().outputPath("live-trace-id.txt");
	const continueFile = test.info().outputPath("live-trace-continue");

	// A real reporter run, held open midway until the viewer has caught up.
	const env: NodeJS.ProcessEnv = {
		...process.env,
		LIVE_TRACE_API_ENDPOINT: LIVE_TRACE_API_URL,
		LIVE_TRACE_ID_FILE: traceIdFile,
		LIVE_TRACE_CONTINUE_FILE: continueFile,
	};
	delete env.PWDEBUG;
	const producer = spawn(
		"pnpm",
		[
			"--filter",
			"../reporter",
			"exec",
			"playwright",
			"test",
			"-c",
			"playwright-live.config.ts",
		],
		{ env, stdio: "pipe" },
	);
	let producerOutput = "";
	producer.stdout.on("data", (chunk) => (producerOutput += chunk));
	producer.stderr.on("data", (chunk) => (producerOutput += chunk));
	const producerExit = new Promise<number | null>((resolve) =>
		producer.on("exit", resolve),
	);

	try {
		await expect
			.poll(() => existsSync(traceIdFile), {
				message: "the live test to start",
				timeout: 60_000,
			})
			.toBe(true);
		const traceId = readFileSync(traceIdFile, "utf-8").trim();

		const viewer = new TraceViewerPage(page);
		await page.goto(
			`/?traceSource=${encodeURIComponent(`${LIVE_TRACE_API_URL}/playwright-otel-live/v1/${traceId}`)}`,
		);

		// Mid-test: the steps so far and a screenshot, but not what comes next.
		await expect(viewer.header.testName).toHaveText("live session");
		await expect(viewer.header.status).toHaveText("running");
		await expect(page.getByTestId("live-badge")).toBeVisible();
		await expect(viewer.steps.spanByName("Open the first page")).toBeVisible();
		await expect(viewer.browserSpans.spans().first()).toBeVisible();
		await expect(viewer.screenshots.images().first()).toBeVisible();
		await expect(viewer.steps.spanByName("Open the second page")).toHaveCount(
			0,
		);

		writeFileSync(continueFile, "");

		// The rest arrives without reloading, and the trace ends.
		await expect(viewer.steps.spanByName("Open the second page")).toBeVisible();
		await expect(viewer.header.status).toHaveText("passed");
		await expect(page.getByTestId("live-badge")).toBeHidden();

		expect(await producerExit, producerOutput).toBe(0);
	} finally {
		producer.kill();
	}
});

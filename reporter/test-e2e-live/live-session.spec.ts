import { existsSync, writeFileSync } from "node:fs";
import { test } from "../dist/fixture.mjs";

const liveTraceApiEndpoint = process.env.LIVE_TRACE_API_ENDPOINT;
const traceIdFile = process.env.LIVE_TRACE_ID_FILE;
const continueFile = process.env.LIVE_TRACE_CONTINUE_FILE;

test("live session", async ({ page }) => {
	if (!traceIdFile || !continueFile) {
		throw new Error(
			"LIVE_TRACE_ID_FILE and LIVE_TRACE_CONTINUE_FILE are required",
		);
	}

	const traceContext = test
		.info()
		.attachments.find(
			(attachment) =>
				attachment.name === "playwright-opentelemetry-trace-context",
		);
	const { traceId } = JSON.parse(traceContext!.body!.toString());
	writeFileSync(traceIdFile, traceId);

	await test.step("Open the first page", async () => {
		// A real navigation, so browser and network spans stream too.
		await page.goto(`${liveTraceApiEndpoint}/health`);
		await page.setContent(
			'<body style="background:#2563eb;color:white"><h1>First page</h1></body>',
		);
	});

	// Holds the test open until the viewer has seen the steps so far.
	await test.step("Wait for the viewer", async () => {
		const deadline = Date.now() + 60_000;
		while (!existsSync(continueFile)) {
			if (Date.now() > deadline) throw new Error("The viewer never caught up");
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	});

	await test.step("Open the second page", async () => {
		await page.setContent(
			'<body style="background:#16a34a;color:white"><h1>Second page</h1></body>',
		);
		await page.waitForTimeout(500);
	});
});

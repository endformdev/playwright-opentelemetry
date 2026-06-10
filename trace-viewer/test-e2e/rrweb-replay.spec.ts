import { readFileSync } from "node:fs";
import { expect, type Locator, test } from "@playwright/test";
import { TraceViewerPage } from "./page-objects/trace-viewer-page";
import { RRWEB_STATES_TRACE_ID_FILE } from "./setup/global-setup";

test.describe("rrweb replay", () => {
	test("renders captured DOM states at the expected replay frames", async ({
		page,
	}) => {
		const traceId = readFileSync(RRWEB_STATES_TRACE_ID_FILE, "utf-8").trim();
		const viewer = new TraceViewerPage(page);

		await viewer.loadTraceFromApi(traceId);
		await expect(viewer.header.testName).toHaveText(
			"rrweb deterministic state replay",
			{ timeout: 10000 },
		);

		const frames = viewer.replay.frames();
		await expect(frames.first()).toBeVisible({ timeout: 10000 });

		await expect
			.poll(async () => frameStateCoverage(frames), { timeout: 15000 })
			.toEqual({ state1: true, state2: true, state3: true });

		const state3FrameIndex = await frameIndexContainingText(
			frames,
			"RRWEB STATE 3",
		);
		const state3Frame = frames.nth(state3FrameIndex);

		await expect(state3Frame.locator(".replayer-mouse")).toBeHidden();
		await expectReplayerIframeContained(
			state3Frame,
			state3Frame.locator("iframe"),
		);

		await state3Frame.hover();

		const preview = page.getByTestId("rrweb-replay-preview");
		await expect
			.poll(async () => replayIframeText(preview.locator("iframe")), {
				timeout: 10000,
			})
			.toContain("RRWEB STATE 3");
		await expect(preview.locator(".replayer-mouse")).toBeHidden();
		await expectReplayerIframeContained(preview, preview.locator("iframe"));
	});
});

async function frameStateCoverage(frames: Locator) {
	const texts = await replayFrameTexts(frames);
	return {
		state1: texts.some((text) => text.includes("RRWEB STATE 1")),
		state2: texts.some((text) => text.includes("RRWEB STATE 2")),
		state3: texts.some((text) => text.includes("RRWEB STATE 3")),
	};
}

async function frameIndexContainingText(
	frames: Locator,
	text: string,
): Promise<number> {
	const count = await frames.count();
	for (let index = 0; index < count; index++) {
		const frameText = await replayIframeText(
			frames.nth(index).locator("iframe"),
		);
		if (frameText.includes(text)) return index;
	}
	throw new Error(`No replay frame contained ${text}`);
}

async function replayFrameTexts(frames: Locator): Promise<string[]> {
	const count = await frames.count();
	const texts: string[] = [];
	for (let index = 0; index < count; index++) {
		texts.push(await replayIframeText(frames.nth(index).locator("iframe")));
	}
	return texts;
}

async function replayIframeText(iframeLocator: Locator): Promise<string> {
	const iframeElement = await iframeLocator.first().elementHandle();
	const frame = await iframeElement?.contentFrame();
	return (await frame?.evaluate(() => document.body.innerText)) ?? "";
}

async function expectReplayerIframeContained(
	container: Locator,
	iframe: Locator,
) {
	const [containerBox, iframeBox] = await Promise.all([
		container.boundingBox(),
		iframe.first().boundingBox(),
	]);

	expect(containerBox).not.toBeNull();
	expect(iframeBox).not.toBeNull();
	expect(iframeBox!.width).toBeLessThanOrEqual(containerBox!.width + 1);
	expect(iframeBox!.height).toBeLessThanOrEqual(containerBox!.height + 1);
}

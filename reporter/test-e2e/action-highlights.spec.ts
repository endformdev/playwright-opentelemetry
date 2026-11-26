import type { Locator, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";
import type { ExpectedAction } from "./action-highlights-reporter";

// The fixture records where each action landed in the screenshots ZIP's
// actions.json, which only exists once the test is over. So each test says
// what it expects there, and action-highlights-reporter.ts checks the file.

test.use({ viewport: { width: 800, height: 600 } });

test("records where a click and a fill landed", async ({ page }, testInfo) => {
	await page.setContent(`
		<body style="margin:0">
			<button id="save" style="position:absolute;left:40px;top:30px;width:120px;height:40px">Save</button>
			<input id="name" style="position:absolute;left:40px;top:120px;width:200px;height:24px">
		</body>`);

	await page.locator("#save").click();
	await page.locator("#name").fill("Ada");
	// The fixture keeps measuring for a while to see that the input stays put.
	await page.waitForTimeout(700);

	await expectActions(testInfo, [
		{
			method: "click",
			box: await boxOf(page.locator("#save")),
			point: { x: 100, y: 50 },
			steady: "held",
			moved: false,
		},
		{
			method: "fill",
			box: await boxOf(page.locator("#name")),
			point: null,
			steady: "held",
			moved: false,
		},
	]);
});

test("records an element where it is after the action scrolled to it", async ({
	page,
}, testInfo) => {
	await page.setContent(`
		<body style="margin:0;height:4000px">
			<button id="top" style="position:absolute;left:20px;top:20px">Top</button>
			<input id="far" style="position:absolute;left:20px;top:2400px">
			<button id="farther" style="position:absolute;left:20px;top:3600px">Farther</button>
		</body>`);

	await page.locator("#top").click();
	const top = await boxOf(page.locator("#top"));
	await page.locator("#far").fill("below the fold");
	const far = await boxOf(page.locator("#far"));
	await page.locator("#farther").click();
	const farther = await boxOf(page.locator("#farther"));

	expect(far.y).toBeLessThan(600);
	await expectActions(testInfo, [
		// The fill scrolls the page: the click's highlight has to end before it.
		{ method: "click", box: top, steady: "until-next-action", moved: false },
		{ method: "fill", box: far, steady: "until-next-action", moved: true },
		{ method: "click", box: farther, moved: true },
	]);
});

test("records actions inside an iframe in the page's coordinates", async ({
	page,
}, testInfo) => {
	await page.setContent(`
		<body style="margin:0">
			<iframe style="position:absolute;left:120px;top:90px;width:400px;height:300px;border:7px solid #999;padding:11px"
				srcdoc="<body style='margin:0'><div style='height:900px'></div><input id='inner' style='margin-left:30px'><button id='go'>Go</button></body>"></iframe>
		</body>`);
	const frame = page.frameLocator("iframe");

	await frame.locator("#inner").fill("in a frame");
	const inner = await boxOf(frame.locator("#inner"));
	await frame.locator("#go").click();
	const go = await boxOf(frame.locator("#go"));

	// 120 + 7 + 11 from the page's edge to the frame's content, then 30.
	expect(inner.x).toBe(168);
	await expectActions(testInfo, [
		// The input is below the frame's fold: filling it scrolls the frame.
		{ method: "fill", box: inner, point: null, moved: true },
		{ method: "click", box: go },
	]);
});

test("records every attempt of a click that failed", async ({
	page,
}, testInfo) => {
	await page.setContent(`
		<body style="margin:0">
			<button id="covered" style="position:absolute;left:40px;top:40px;width:100px;height:40px">Covered</button>
			<div style="position:absolute;left:0;top:0;width:300px;height:200px;background:rgba(0,0,0,0.2)"></div>
		</body>`);

	await expect(
		page.locator("#covered").click({ timeout: 1000 }),
	).rejects.toThrow(/intercepts pointer events/);

	await expectActions(testInfo, [
		{
			method: "click",
			failed: true,
			inputs: "several",
			box: await boxOf(page.locator("#covered")),
			steady: "held",
		},
	]);
});

test("records both ends of a drag", async ({ page }, testInfo) => {
	await page.setContent(`
		<body style="margin:0">
			<div id="card" draggable="true" style="position:absolute;left:30px;top:30px;width:80px;height:40px;background:#bfdbfe">Card</div>
			<div id="lane" style="position:absolute;left:400px;top:300px;width:200px;height:120px;background:#e5e7eb">Lane</div>
		</body>`);

	await page.locator("#card").dragTo(page.locator("#lane"));

	await expectActions(testInfo, [
		{
			method: "dragAndDrop",
			inputs: 2,
			firstBox: await boxOf(page.locator("#card")),
			box: await boxOf(page.locator("#lane")),
		},
	]);
});

test("stops vouching for an element the action removed", async ({
	page,
}, testInfo) => {
	await page.setContent(`
		<body style="margin:0">
			<button id="dismiss" onclick="this.remove()" style="position:absolute;left:40px;top:40px;width:100px;height:40px">Dismiss</button>
		</body>`);
	const dismiss = await boxOf(page.locator("#dismiss"));

	await page.locator("#dismiss").click();
	await page.waitForTimeout(300);

	await expectActions(testInfo, [
		{ method: "click", box: dismiss, steady: "lost" },
	]);
});

test("records raw mouse input and leaves out the keyboard", async ({
	page,
}, testInfo) => {
	await page.setContent(`
		<body style="margin:0">
			<input id="secret" type="password" style="position:absolute;left:40px;top:40px">
		</body>`);

	await page.mouse.click(300, 200);
	await page.keyboard.press("Tab");
	await page.locator("#secret").fill("hunter2-do-not-record");
	await page.locator("#secret").press("Enter");

	const secret = await boxOf(page.locator("#secret"));
	await testInfo.attach("forbidden-in-actions", {
		body: "hunter2-do-not-record",
	});
	await expectActions(testInfo, [
		{
			method: "mouseClick",
			point: { x: 300, y: 200 },
			box: null,
			steady: "none",
		},
		{ method: "fill", box: secret, point: null },
		{ method: "press", box: secret, point: null },
	]);
});

test("records each page's actions under its own page id", async ({
	page,
	context,
}, testInfo) => {
	await page.setContent(
		`<body style="margin:0"><button id="first" style="margin:20px">First</button></body>`,
	);
	const popup = await context.newPage();
	await popup.setContent(
		`<body style="margin:0"><button id="second" style="margin:60px">Second</button></body>`,
	);

	await page.locator("#first").click();
	await popup.locator("#second").click();

	await expectActions(testInfo, [
		{
			method: "click",
			pageId: "page-0",
			box: await boxOf(page.locator("#first")),
		},
		{
			method: "click",
			pageId: "page-1",
			box: await boxOf(popup.locator("#second")),
		},
	]);
});

async function boxOf(locator: Locator) {
	const box = await locator.boundingBox();
	if (!box) {
		throw new Error("The element has no box");
	}
	return box;
}

async function expectActions(
	testInfo: TestInfo,
	actions: ExpectedAction[],
): Promise<void> {
	await testInfo.attach("expected-actions", {
		body: JSON.stringify(actions),
		contentType: "application/json",
	});
}

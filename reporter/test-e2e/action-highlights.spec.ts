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

	await expectActions(testInfo, [
		{
			method: "click",
			box: await boxOf(page.locator("#save")),
			point: { x: 100, y: 50 },
		},
		{
			method: "fill",
			box: await boxOf(page.locator("#name")),
			point: null,
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
		{ method: "click", box: top },
		{ method: "fill", box: far, point: null },
		{ method: "click", box: farther },
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
		{ method: "fill", box: inner, point: null },
		{ method: "click", box: go },
	]);
});

test("records a click that failed", async ({ page }, testInfo) => {
	await page.setContent(`
		<body style="margin:0">
			<button id="covered" style="position:absolute;left:40px;top:40px;width:100px;height:40px">Covered</button>
			<div style="position:absolute;left:0;top:0;width:300px;height:200px;background:rgba(0,0,0,0.2)"></div>
		</body>`);

	await expect(
		page.locator("#covered").click({ timeout: 500 }),
	).rejects.toThrow(/intercepts pointer events/);

	await expectActions(testInfo, [
		{
			method: "click",
			failed: true,
			box: await boxOf(page.locator("#covered")),
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
			dragFromIn: await boxOf(page.locator("#card")),
			box: await boxOf(page.locator("#lane")),
		},
	]);
});

test("records a click that removes its own element", async ({
	page,
}, testInfo) => {
	await page.setContent(`
		<body style="margin:0">
			<button id="dismiss" onclick="this.remove()" style="position:absolute;left:40px;top:40px;width:100px;height:40px">Dismiss</button>
		</body>`);
	const dismiss = await boxOf(page.locator("#dismiss"));

	await page.locator("#dismiss").click();

	await expectActions(testInfo, [{ method: "click", box: dismiss }]);
});

test("records raw mouse input and leaves out the keyboard and typed values", async ({
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
		{ method: "mouseClick", point: { x: 300, y: 200 }, box: null },
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

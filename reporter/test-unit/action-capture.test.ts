import type { BrowserContext } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ActionCapture,
	type ActionElement,
	ActionRecorder,
	parseServerCall,
} from "../src/fixture/action-capture";

describe("ActionRecorder", () => {
	it("records a pointer click with start, end, point, and box", async () => {
		let now = 960;
		const recorder = new ActionRecorder(() => now);

		recorder.callStarted("call@1");
		now = 1000;
		recorder.input({
			callId: "call@1",
			pageId: "page-0",
			method: "click",
			point: { x: 100.456, y: 50.123 },
			box: { x: 40.004, y: 30.999, width: 120, height: 40 },
		});
		now = 1035;
		recorder.callEnded("call@1", false);

		expect(await recorder.finish()).toEqual([
			{
				pageId: "page-0",
				start: 960,
				end: 1035,
				method: "click",
				point: { x: 100.46, y: 50.12 },
				box: { x: 40, y: 31, width: 120, height: 40 },
			},
		]);
	});

	it("keeps the latest coordinates on retries and marks failed calls", async () => {
		let now = 1000;
		const recorder = new ActionRecorder(() => now);

		recorder.input({
			callId: "call@1",
			pageId: "page-0",
			method: "click",
			point: { x: 10, y: 20 },
			box: { x: 0, y: 0, width: 20, height: 40 },
		});
		now = 1200;
		recorder.input({
			callId: "call@1",
			pageId: "page-0",
			method: "click",
			point: { x: 50, y: 60 },
			box: { x: 40, y: 40, width: 20, height: 40 },
		});
		now = 1500;
		recorder.callEnded("call@1", true);

		expect(await recorder.finish()).toEqual([
			{
				pageId: "page-0",
				start: 1000,
				end: 1500,
				method: "click",
				point: { x: 50, y: 60 },
				box: { x: 40, y: 40, width: 20, height: 40 },
				failed: true,
			},
		]);
	});

	it("records dragFrom and drop target for dragAndDrop", async () => {
		let now = 2000;
		const recorder = new ActionRecorder(() => now);

		recorder.input({
			callId: "call@drag",
			pageId: "page-0",
			method: "dragAndDrop",
			point: { x: 50, y: 60 },
		});
		now = 2020;
		recorder.input({
			callId: "call@drag",
			pageId: "page-0",
			method: "dragAndDrop",
			point: { x: 300, y: 180 },
			box: { x: 250, y: 150, width: 100, height: 60 },
		});
		now = 2080;
		recorder.callEnded("call@drag", false);

		expect(await recorder.finish()).toEqual([
			{
				pageId: "page-0",
				start: 2000,
				end: 2080,
				method: "dragAndDrop",
				point: { x: 300, y: 180 },
				box: { x: 250, y: 150, width: 100, height: 60 },
				dragFrom: { x: 50, y: 60 },
			},
		]);
	});

	it("re-measures non-pointer element actions once at call end and releases the handle", async () => {
		let now = 3000;
		const recorder = new ActionRecorder(() => now);
		const release = vi.fn();
		const measure = vi.fn(async () => ({
			x: 120,
			y: 220,
			width: 200,
			height: 30,
		}));
		const element: ActionElement = { measure, release };

		recorder.input({
			callId: "call@fill",
			pageId: "page-0",
			method: "fill",
			box: { x: 10, y: 900, width: 200, height: 30 },
			boxInChildFrame: true,
			element,
		});
		expect(measure).not.toHaveBeenCalled();

		now = 3050;
		recorder.callEnded("call@fill", false);

		expect(await recorder.finish()).toEqual([
			{
				pageId: "page-0",
				start: 3000,
				end: 3050,
				method: "fill",
				box: { x: 120, y: 220, width: 200, height: 30 },
			},
		]);
		expect(measure).toHaveBeenCalledOnce();
		expect(release).toHaveBeenCalledOnce();
	});

	it("drops an iframe-local fallback box if post-call re-measurement fails, but keeps main-frame fallback", async () => {
		let now = 4000;
		const recorder = new ActionRecorder(() => now);
		const releaseIframe = vi.fn();
		const releaseMain = vi.fn();

		recorder.input({
			callId: "call@iframe-fill",
			pageId: "page-0",
			method: "fill",
			box: { x: 10, y: 20, width: 100, height: 30 },
			boxInChildFrame: true,
			element: {
				measure: async () => null,
				release: releaseIframe,
			},
		});
		recorder.callEnded("call@iframe-fill", false);

		now = 4100;
		recorder.input({
			callId: "call@main-fill",
			pageId: "page-0",
			method: "fill",
			box: { x: 40, y: 80, width: 100, height: 30 },
			boxInChildFrame: false,
			element: {
				measure: async () => {
					throw new Error("element detached");
				},
				release: releaseMain,
			},
		});
		recorder.callEnded("call@main-fill", false);

		expect(await recorder.finish()).toEqual([
			{
				pageId: "page-0",
				start: 4100,
				end: 4100,
				method: "fill",
				box: { x: 40, y: 80, width: 100, height: 30 },
			},
		]);
		expect(releaseIframe).toHaveBeenCalledOnce();
		expect(releaseMain).toHaveBeenCalledOnce();
	});

	it("drops open calls and releases their handles on finish, and orders completed calls by start", async () => {
		let now = 5000;
		const recorder = new ActionRecorder(() => now);
		const releaseOpen = vi.fn();

		recorder.input({
			callId: "call@open",
			pageId: "page-0",
			method: "fill",
			box: { x: 0, y: 0, width: 10, height: 10 },
			element: {
				measure: async () => null,
				release: releaseOpen,
			},
		});

		now = 5100;
		recorder.input({
			callId: "call@second",
			pageId: "page-0",
			method: "click",
			point: { x: 20, y: 20 },
		});
		now = 5050;
		recorder.input({
			callId: "call@first",
			pageId: "page-0",
			method: "click",
			point: { x: 10, y: 10 },
		});
		now = 5200;
		recorder.callEnded("call@second", false);
		recorder.callEnded("call@first", false);

		const actions = await recorder.finish();
		expect(actions.map((a) => a.point)).toEqual([
			{ x: 10, y: 10 },
			{ x: 20, y: 20 },
		]);
		expect(releaseOpen).toHaveBeenCalledOnce();
	});

	it("ignores inputs without point or box and releases any attached handle", async () => {
		const recorder = new ActionRecorder(() => 1000);
		const release = vi.fn();

		recorder.input({
			callId: "call@key",
			pageId: "page-0",
			method: "press",
			element: { measure: async () => null, release },
		});
		recorder.callEnded("call@key", false);

		expect(await recorder.finish()).toEqual([]);
		expect(release).toHaveBeenCalledOnce();
	});
});

describe("parseServerCall", () => {
	it("parses Playwright's (progress, sdkObject) listener arguments", () => {
		const sdkObject = { attribution: { page: { guid: "page@1" } } };
		expect(
			parseServerCall([
				{
					metadata: {
						id: "call@1",
						method: "click",
						internal: false,
						error: { error: { message: "boom" } },
					},
				},
				sdkObject,
			]),
		).toEqual({
			id: "call@1",
			method: "click",
			internal: false,
			failed: true,
			sdkObject,
		});
	});

	it("returns undefined for unrecognized shapes", () => {
		expect(parseServerCall([{}, {}])).toBeUndefined();
		expect(
			parseServerCall([{ id: "call@1", method: "click" }]),
		).toBeUndefined();
	});
});

describe("ActionCapture", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("subscribes to server instrumentation, records actions, and unsubscribes on stop", async () => {
		const listeners: Array<{
			onBeforeInputAction: (...args: unknown[]) => Promise<void>;
			onAfterCall: (...args: unknown[]) => Promise<void>;
		}> = [];
		const serverContext = {
			instrumentation: {
				addListener: vi.fn((listener) => listeners.push(listener)),
				removeListener: vi.fn(),
			},
		};
		const context = {
			_connection: { toImpl: () => serverContext },
		} as unknown as BrowserContext;

		const capture = new ActionCapture((guid) =>
			guid === "page@1" ? "page-0" : undefined,
		);
		capture.addContext(context);

		const mainFrame = {};
		const sdkObject = {
			attribution: {
				page: { guid: "page@1", mainFrame: () => mainFrame },
				frame: mainFrame,
			},
		};
		const progress = { metadata: { id: "call@1", method: "click" } };
		await listeners[0].onBeforeInputAction(
			progress,
			sdkObject,
			{ x: 15, y: 25 },
			{ x: 10, y: 20, width: 30, height: 20 },
		);
		// Internal calls are ignored.
		await listeners[0].onBeforeInputAction(
			{ metadata: { id: "call@internal", method: "click", internal: true } },
			sdkObject,
			{ x: 1, y: 1 },
		);
		await listeners[0].onAfterCall(progress, sdkObject);

		const result = await capture.stop();
		expect(result).toEqual({
			version: 1,
			actions: [
				expect.objectContaining({
					pageId: "page-0",
					method: "click",
					point: { x: 15, y: 25 },
					box: { x: 10, y: 20, width: 30, height: 20 },
				}),
			],
		});
		expect(serverContext.instrumentation.removeListener).toHaveBeenCalledWith(
			listeners[0],
		);
	});

	it("warns once and returns undefined when instrumentation is unavailable", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const capture = new ActionCapture(() => "page-0");

		capture.addContext({} as unknown as BrowserContext);
		capture.addContext({} as unknown as BrowserContext);

		expect(await capture.stop()).toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
	});

	it("gives up, removes listeners, and warns once on an unrecognized listener shape", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let added: {
			onBeforeInputAction: (...args: unknown[]) => Promise<void>;
		} | null = null;
		const removeListener = vi.fn();
		const context = {
			_connection: {
				toImpl: () => ({
					instrumentation: {
						addListener: (listener: typeof added) => {
							added = listener;
						},
						removeListener,
					},
				}),
			},
		} as unknown as BrowserContext;

		const capture = new ActionCapture(() => "page-0");
		capture.addContext(context);
		await added!.onBeforeInputAction({ unexpected: true });

		expect(removeListener).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledOnce();
		expect(await capture.stop()).toBeUndefined();
	});
});

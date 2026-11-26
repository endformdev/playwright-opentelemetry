import type { BrowserContext } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ACTION_MAX_CHECKS,
	ACTION_MIN_CHECK_GAP_MS,
	ACTION_WATCH_MS,
	ActionCapture,
	type ActionElement,
	ActionRecorder,
	parseServerCall,
} from "../src/fixture/action-capture";
import type { ActionBox } from "../src/shared/screenshots-zip";

const BOX: ActionBox = { x: 10, y: 20, width: 100, height: 40 };
const START = 1_000_000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(START);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/** An element whose box the test moves around, or takes away with null. */
function fakeElement(box: ActionBox | null = BOX) {
	const element = {
		box,
		measured: 0,
		measuredAt: [] as number[],
		released: false,
		measure: vi.fn(async () => {
			element.measured += 1;
			element.measuredAt.push(Date.now());
			return element.box;
		}),
		release: vi.fn(() => {
			element.released = true;
		}),
	};
	return element satisfies ActionElement & Record<string, unknown>;
}

async function advance(ms: number): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
}

describe("ActionRecorder", () => {
	it("records a pointer action with its point and box", async () => {
		const recorder = new ActionRecorder();

		recorder.input({
			callId: "call@1",
			pageId: "page-0",
			method: "click",
			point: { x: 60, y: 40 },
			box: BOX,
			element: fakeElement(),
		});
		// Sooner than it would measure again for a frame.
		await advance(3);
		recorder.callEnded("call@1", false);

		expect(await recorder.finish()).toEqual([
			{
				pageId: "page-0",
				end: START + 3,
				method: "click",
				inputs: [{ time: START, point: { x: 60, y: 40 }, box: BOX }],
				steadyUntil: START + 3,
			},
		]);
	});

	it("vouches for the element at every frame it's still in place for", async () => {
		const recorder = new ActionRecorder();
		const element = fakeElement();

		recorder.input({ ...click("call@1"), element });
		await advance(10);
		recorder.callEnded("call@1", false);
		await advance(50);
		recorder.frameTaken("page-0");
		await advance(150);
		recorder.frameTaken("page-0");
		// The page scrolls, and takes a frame of that.
		await advance(40);
		element.box = { ...BOX, y: BOX.y - 300 };
		recorder.frameTaken("page-0");
		await advance(40);
		// Scrolling back doesn't bring the watch back.
		element.box = BOX;
		recorder.frameTaken("page-0");

		const [action] = await recorder.finish();
		expect(action.steadyUntil).toBe(START + 210);
		expect(element.released).toBe(true);
	});

	it("vouches for a frame that comes right after the last measurement", async () => {
		const recorder = new ActionRecorder();
		const element = fakeElement();

		recorder.input({ ...click("call@1"), element });
		await advance(4);
		recorder.callEnded("call@1", false);
		// The frame showing the click's effect, sooner than it measures again.
		await advance(3);
		recorder.frameTaken("page-0");
		await advance(ACTION_MIN_CHECK_GAP_MS);

		const [action] = await recorder.finish();
		expect(action.steadyUntil).toBeGreaterThanOrEqual(START + 7);
		expect(action.steadyUntil).toBeLessThanOrEqual(
			START + 4 + ACTION_MIN_CHECK_GAP_MS,
		);
	});

	it("vouches for a frame that came just before recording stopped", async () => {
		const recorder = new ActionRecorder();
		const element = fakeElement();

		recorder.input({ ...click("call@1"), element });
		await advance(4);
		recorder.callEnded("call@1", false);
		await advance(3);
		recorder.frameTaken("page-0");

		const [action] = await recorder.finish();
		expect(action.steadyUntil).toBe(START + 7);
	});

	describe("whether a pointer action scrolled to its element", () => {
		it("knows it didn't when the element was in the same place as the call began", async () => {
			const recorder = new ActionRecorder();

			recorder.callStarted("call@1", Promise.resolve(BOX));
			await advance(30);
			recorder.input({ ...click("call@1"), element: fakeElement() });
			recorder.callEnded("call@1", false);

			const [action] = await recorder.finish();
			// In its place since the call began, 30 ms before the input.
			expect(action.steadySince).toBe(START);
			expect(action).not.toHaveProperty("steadyFrom");
		});

		it("knows it did when the element was somewhere else as the call began", async () => {
			const recorder = new ActionRecorder();

			recorder.callStarted(
				"call@1",
				Promise.resolve({ ...BOX, y: BOX.y + 1800 }),
			);
			await advance(30);
			recorder.input({ ...click("call@1"), element: fakeElement() });
			await advance(5);
			recorder.callEnded("call@1", false);

			const [action] = await recorder.finish();
			expect(action).not.toHaveProperty("steadySince");
			// In its place from the input on, not before.
			expect(action.steadyFrom).toBe(START + 30);
		});

		it("doesn't know when the element wasn't there yet as the call began", async () => {
			const recorder = new ActionRecorder();

			recorder.callStarted("call@1", Promise.resolve(undefined));
			recorder.input({ ...click("call@1"), element: fakeElement() });
			recorder.callEnded("call@1", false);

			const [action] = await recorder.finish();
			expect(action).not.toHaveProperty("steadySince");
			expect(action).not.toHaveProperty("steadyFrom");
		});

		it("says nothing of it for a browser whose frames are stamped late", async () => {
			const recorder = new ActionRecorder();

			recorder.callStarted("call@1", Promise.resolve(BOX));
			recorder.input({
				...click("call@1"),
				promptFrames: false,
				element: fakeElement(),
			});
			recorder.callEnded("call@1", false);

			const [action] = await recorder.finish();
			expect(action).not.toHaveProperty("steadySince");
			expect(action.steadyUntil).toBe(START);
		});

		it("doesn't know for a later attempt, long after the call began", async () => {
			const recorder = new ActionRecorder();

			recorder.callStarted("call@1", Promise.resolve(BOX));
			recorder.input({ ...click("call@1"), element: fakeElement() });
			await advance(500);
			recorder.input({ ...click("call@1"), element: fakeElement() });
			recorder.callEnded("call@1", false);

			const [action] = await recorder.finish();
			expect(action).not.toHaveProperty("steadySince");
		});

		it("waits for the first measurement before it stops recording", async () => {
			const recorder = new ActionRecorder();
			let measured = (_box: ActionBox) => {};

			recorder.callStarted(
				"call@1",
				new Promise((resolve) => {
					measured = resolve;
				}),
			);
			recorder.input({ ...click("call@1"), element: fakeElement() });
			recorder.callEnded("call@1", false);
			const finished = recorder.finish();
			measured(BOX);

			expect((await finished)[0].steadySince).toBe(START);
		});
	});

	describe("a page that changed as a whole", () => {
		it("keeps later actions from being drawn on frames from before", async () => {
			const recorder = new ActionRecorder();

			recorder.pageChanged("page-0");
			recorder.pageChanged("page-1");
			await advance(40);
			recorder.callStarted("call@1", Promise.resolve(BOX));
			recorder.input({ ...click("call@1"), element: fakeElement() });
			recorder.callEnded("call@1", false);
			// What the click itself led to comes after its input.
			recorder.pageChanged("page-0");

			const [action] = await recorder.finish();
			expect(action.steadyFrom).toBe(START);
			expect(action.steadySince).toBe(START + 40);
		});

		it("applies to input without an element too", async () => {
			const recorder = new ActionRecorder();

			recorder.pageChanged("page-0");
			await advance(40);
			recorder.input({
				callId: "call@1",
				pageId: "page-0",
				method: "mouseClick",
				point: { x: 300, y: 200 },
			});
			recorder.callEnded("call@1", false);

			const [action] = await recorder.finish();
			expect(action.steadyFrom).toBe(START);
		});

		it("gives way to an action that scrolled later still", async () => {
			const recorder = new ActionRecorder();
			const element = fakeElement({ ...BOX, y: 2000 });

			recorder.pageChanged("page-0");
			await advance(40);
			recorder.input({
				callId: "call@1",
				pageId: "page-0",
				method: "fill",
				box: { ...BOX, y: 2000 },
				element,
			});
			element.box = { ...BOX, y: 582 };
			await advance(8);
			recorder.callEnded("call@1", false);

			const [action] = await recorder.finish();
			expect(action.steadyFrom).toBe(START + 48);
		});
	});

	it("only looks at frames of the action's own page", async () => {
		const recorder = new ActionRecorder();
		const element = fakeElement();
		recorder.input({ ...click("call@1"), element });
		recorder.callEnded("call@1", false);
		await advance(50);
		const measured = element.measured;

		recorder.frameTaken("page-1");

		expect(element.measured).toBe(measured);
	});

	it("stops vouching when the action took the element away", async () => {
		const recorder = new ActionRecorder();
		const element = fakeElement();

		recorder.input({ ...click("call@1"), element });
		await advance(10);
		element.box = null;
		await advance(20);
		recorder.callEnded("call@1", false);

		const [action] = await recorder.finish();
		expect(action.steadyUntil).toBe(START);
		expect(action.end).toBe(START + 30);
	});

	it("stops watching a while after the call, and lets go of the element", async () => {
		const recorder = new ActionRecorder();
		const element = fakeElement();

		recorder.input({ ...click("call@1"), element });
		recorder.callEnded("call@1", false);
		await advance(ACTION_WATCH_MS - 20);
		recorder.frameTaken("page-0");
		await advance(20);
		const measured = element.measured;
		await advance(5000);
		recorder.frameTaken("page-0");

		expect(element.released).toBe(true);
		expect(element.measured).toBe(measured);
		const [action] = await recorder.finish();
		expect(action.steadyUntil).toBe(START + ACTION_WATCH_MS - 20);
	});

	it("keeps vouching for an action after the next one on the page has begun", async () => {
		// Filling a form: the frame showing the first field filled arrives
		// once the second is being filled.
		const recorder = new ActionRecorder();
		const first = fakeElement();
		recorder.input({ ...click("call@1"), element: first });
		recorder.callEnded("call@1", false);
		await advance(3);

		recorder.input({ ...click("call@2"), element: fakeElement() });
		recorder.callEnded("call@2", false);
		await advance(20);
		recorder.frameTaken("page-0");

		const [action] = await recorder.finish();
		expect(action.steadyUntil).toBe(START + 23);
		expect(first.released).toBe(true);
	});

	it("doesn't measure at every frame of a page that animates", async () => {
		const recorder = new ActionRecorder();
		const element = fakeElement();
		recorder.input({ ...click("call@1"), element });

		for (let frame = 0; frame < 2000; frame++) {
			recorder.frameTaken("page-0");
			await advance(2);
		}

		expect(element.measured).toBeLessThanOrEqual(ACTION_MAX_CHECKS + 1);
		for (let index = 1; index < element.measuredAt.length; index++) {
			expect(
				element.measuredAt[index] - element.measuredAt[index - 1],
			).toBeGreaterThanOrEqual(ACTION_MIN_CHECK_GAP_MS);
		}
	});

	describe("input without a point, such as a fill", () => {
		const fill = {
			callId: "call@1",
			pageId: "page-0",
			method: "fill",
			box: BOX,
			promptFrames: true,
		};

		it("is drawn where the page measures the element, from the input on, when it stays put", async () => {
			const recorder = new ActionRecorder();
			const inPage = { ...BOX, x: 168, y: 390 };

			// Found in an iframe: the box it comes with is the frame's.
			recorder.input({
				...fill,
				boxInChildFrame: true,
				element: fakeElement(inPage),
			});
			await advance(12);
			recorder.callEnded("call@1", false);

			expect(await recorder.finish()).toEqual([
				{
					pageId: "page-0",
					end: START + 12,
					method: "fill",
					inputs: [{ time: START, box: inPage }],
					steadySince: START,
					steadyUntil: START + 12,
				},
			]);
		});

		it("is drawn where the element ended up when filling scrolled to it", async () => {
			const recorder = new ActionRecorder();
			const element = fakeElement({ ...BOX, y: 2000 });

			recorder.input({ ...fill, box: { ...BOX, y: 2000 }, element });
			await advance(5);
			// A frame from before the scroll says nothing either way.
			recorder.frameTaken("page-0");
			element.box = { ...BOX, y: 582 };
			await advance(7);
			recorder.callEnded("call@1", false);
			await advance(40);
			recorder.frameTaken("page-0");

			expect(await recorder.finish()).toEqual([
				{
					pageId: "page-0",
					end: START + 12,
					method: "fill",
					inputs: [{ time: START, box: { ...BOX, y: 582 } }],
					steadyFrom: START + 12,
					steadyUntil: START + 52,
				},
			]);
		});

		it("keeps where the element was found when it's gone by the end, without vouching for it", async () => {
			const recorder = new ActionRecorder();
			const element = fakeElement();

			recorder.input({ ...fill, method: "press", element });
			await advance(20);
			// Pressing Enter navigated away.
			element.box = null;
			await advance(20);
			recorder.callEnded("call@1", false);

			expect(await recorder.finish()).toEqual([
				{
					pageId: "page-0",
					end: START + 40,
					method: "press",
					inputs: [{ time: START, box: BOX }],
					steadyUntil: START,
				},
			]);
		});

		it("is left out when it's in an iframe and can't be measured in the page", async () => {
			const recorder = new ActionRecorder();

			recorder.input({
				...fill,
				boxInChildFrame: true,
				element: fakeElement(null),
			});
			recorder.callEnded("call@1", false);

			expect(await recorder.finish()).toEqual([]);
		});

		it("keeps the box it came with in the main frame when it can't be measured", async () => {
			const recorder = new ActionRecorder();

			recorder.input({ ...fill, element: fakeElement(null) });
			recorder.callEnded("call@1", false);

			expect(await recorder.finish()).toEqual([
				{
					pageId: "page-0",
					end: START,
					method: "fill",
					inputs: [{ time: START, box: BOX }],
					steadyUntil: START,
				},
			]);
		});
	});

	it("records every attempt of a call that retried, and whether it failed", async () => {
		const recorder = new ActionRecorder();
		const attempts = [fakeElement(), fakeElement(), fakeElement()];

		for (const element of attempts) {
			recorder.input({ ...click("call@1"), element });
			await advance(100);
		}
		recorder.callEnded("call@1", true);

		const [action] = await recorder.finish();
		expect(action.failed).toBe(true);
		expect(action.inputs.map((input) => input.time)).toEqual([
			START,
			START + 100,
			START + 200,
		]);
		expect(action.steadyUntil).toBe(START + 300);
		expect(attempts.map((element) => element.released)).toEqual([
			true,
			true,
			true,
		]);
	});

	it("records both ends of a drag", async () => {
		const recorder = new ActionRecorder();
		const target = { x: 400, y: 300, width: 200, height: 120 };

		recorder.input({
			...click("call@1"),
			method: "dragAndDrop",
			element: fakeElement(),
		});
		await advance(30);
		recorder.input({
			callId: "call@1",
			pageId: "page-0",
			method: "dragAndDrop",
			point: { x: 500, y: 360 },
			box: target,
			element: fakeElement(target),
		});
		recorder.callEnded("call@1", false);

		const [action] = await recorder.finish();
		expect(action.inputs).toEqual([
			{ time: START, point: { x: 60, y: 40 }, box: BOX },
			{ time: START + 30, point: { x: 500, y: 360 }, box: target },
		]);
	});

	it("records raw mouse input without vouching for anything", async () => {
		const recorder = new ActionRecorder();

		recorder.input({
			callId: "call@1",
			pageId: "page-0",
			method: "mouseClick",
			point: { x: 300, y: 200 },
		});
		recorder.callEnded("call@1", false);

		expect(await recorder.finish()).toEqual([
			{
				pageId: "page-0",
				end: START,
				method: "mouseClick",
				inputs: [{ time: START, point: { x: 300, y: 200 } }],
			},
		]);
	});

	it("leaves out calls that sent no input and calls still open at the end", async () => {
		const recorder = new ActionRecorder();
		const open = fakeElement();

		recorder.callEnded("call@1", false);
		recorder.input({ ...click("call@2"), element: open });

		expect(await recorder.finish()).toEqual([]);
		expect(open.released).toBe(true);
	});

	it("orders actions by their first input", async () => {
		const recorder = new ActionRecorder();

		recorder.input({ ...click("call@slow"), method: "hover" });
		await advance(5);
		recorder.input({ ...click("call@fast"), method: "click" });
		recorder.callEnded("call@fast", false);
		await advance(5);
		recorder.callEnded("call@slow", false);

		const actions = await recorder.finish();
		expect(actions.map((action) => action.method)).toEqual(["hover", "click"]);
	});

	it("rounds what it records to hundredths of a pixel", async () => {
		const recorder = new ActionRecorder();

		recorder.input({
			callId: "call@1",
			pageId: "page-0",
			method: "click",
			point: { x: 32.449999, y: 20.5 },
			box: { x: 10, y: 10, width: 44.90625, height: 21 },
		});
		recorder.callEnded("call@1", false);

		const [action] = await recorder.finish();
		expect(action.inputs[0]).toEqual({
			time: START,
			point: { x: 32.45, y: 20.5 },
			box: { x: 10, y: 10, width: 44.91, height: 21 },
		});
	});

	it("doesn't wait on a measurement that never comes back", async () => {
		const recorder = new ActionRecorder();
		const element = fakeElement();
		element.measure.mockImplementation(() => new Promise(() => {}));

		recorder.input({ ...click("call@1"), element });
		recorder.callEnded("call@1", false);
		const finished = recorder.finish();
		await advance(5000);

		const [action] = await finished;
		expect(action.steadyUntil).toBe(START);
		expect(element.released).toBe(true);
	});

	it("survives an element that throws when measured", async () => {
		const recorder = new ActionRecorder();
		const element = fakeElement();
		element.measure.mockRejectedValue(new Error("Target closed"));

		recorder.input({ ...click("call@1"), element });
		await advance(300);
		recorder.callEnded("call@1", false);

		const [action] = await recorder.finish();
		expect(action.steadyUntil).toBe(START);
	});
});

describe("parseServerCall", () => {
	const sdkObject = { attribution: { page: { guid: "page@1" } } };
	const metadata = { id: "call@7", method: "click", internal: false };

	it("reads the (progress, sdkObject) arguments of Playwright 1.63 and later", () => {
		expect(parseServerCall([{ metadata }, sdkObject, { x: 1, y: 2 }])).toEqual({
			id: "call@7",
			method: "click",
			internal: false,
			failed: false,
			params: {},
			sdkObject,
		});
	});

	it("tells a failed call and an internal call", () => {
		const call = parseServerCall([
			{
				metadata: {
					...metadata,
					internal: true,
					error: { error: { message: "Timeout" } },
				},
			},
			sdkObject,
		]);

		expect(call).toMatchObject({ internal: true, failed: true });
	});

	it.each([
		[
			"Playwright 1.61's (sdkObject, metadata, point, box)",
			[sdkObject, metadata, { x: 1, y: 2 }, BOX],
		],
		[
			"Playwright 1.60's (sdkObject, metadata)",
			[sdkObject, { ...metadata, point: { x: 1, y: 2 } }],
		],
		["no arguments", []],
		[
			"a progress without a call id",
			[{ metadata: { method: "click" } }, sdkObject],
		],
		["an object that belongs to nothing", [{ metadata }, {}]],
	])("doesn't read %s", (_, args) => {
		expect(parseServerCall(args)).toBeUndefined();
	});
});

describe("ActionCapture", () => {
	/** Playwright's server, as far as the capture looks at it. */
	function fakeServer(browserName = "chromium") {
		const listeners = new Map<Listener, unknown>();
		const serverContext = {
			instrumentation: {
				addListener: (listener: Listener, context: unknown) =>
					listeners.set(listener, context),
				removeListener: (listener: Listener) => listeners.delete(listener),
			},
		};
		const context = {
			_connection: { toImpl: () => serverContext },
			browser: () => ({ browserType: () => ({ name: () => browserName }) }),
		} as unknown as BrowserContext;
		const mainFrame = { name: "main" };
		const page = { guid: "page@tracked", mainFrame: () => mainFrame };
		return {
			context,
			serverContext,
			listeners,
			listener: () => [...listeners.keys()][0],
			progress: (id: string, method: string, extra = {}) => ({
				metadata: { id, method, ...extra },
			}),
			onPage: <Extra extends object>(extra?: Extra) => ({
				attribution: { page, frame: mainFrame },
				...(extra as Extra),
			}),
		};
	}
	type Listener = Record<string, (...args: unknown[]) => Promise<void>>;

	function capture() {
		return new ActionCapture((guid) =>
			guid === "page@tracked" ? "page-0" : undefined,
		);
	}

	it("listens to the context's server and stops when told to", async () => {
		const server = fakeServer();
		const actions = capture();

		actions.addContext(server.context);
		expect([...server.listeners.values()]).toEqual([server.serverContext]);

		await actions.stop();
		expect(server.listeners.size).toBe(0);
	});

	it("records an action from the server's calls", async () => {
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();
		const progress = server.progress("call@1", "click");

		await listener.onBeforeInputAction(
			progress,
			server.onPage(),
			{ x: 60, y: 40 },
			BOX,
		);
		await listener.onAfterCall(progress, server.onPage());

		expect(await actions.stop()).toEqual({
			version: 1,
			actions: [
				{
					pageId: "page-0",
					end: START,
					method: "click",
					inputs: [{ time: START, point: { x: 60, y: 40 }, box: BOX }],
				},
			],
		});
	});

	it("never makes Playwright wait: every listener returns a promise that's already done", () => {
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();
		const element = {
			evaluateHandle: vi.fn(() => new Promise(() => {})),
			boundingBox: vi.fn(),
		};

		const returned = [
			listener.onBeforeInputAction(
				server.progress("call@1", "fill"),
				server.onPage(element),
				undefined,
				BOX,
			),
			listener.onAfterCall(server.progress("call@1", "fill"), server.onPage()),
		];

		expect(new Set(returned).size).toBe(1);
		expect(element.evaluateHandle).toHaveBeenCalledOnce();
	});

	it("measures the element right away with Playwright's handle, and later with one of its own", async () => {
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();
		// Found below the fold in an iframe; filling it scrolls it into view.
		const kept = {
			boundingBox: vi.fn(async () => ({ ...BOX, y: 582 })),
			dispose: vi.fn(),
		};
		const element = server.onPage({
			evaluateHandle: vi.fn(async () => kept),
			boundingBox: vi.fn(async () => ({ ...BOX, y: 2000 })),
		});
		const progress = server.progress("call@1", "fill");

		const hooked = listener.onBeforeInputAction(progress, element, undefined, {
			...BOX,
			y: 900,
		});
		// Asked for before the listener returns, so the browser measures ahead
		// of Playwright's scrolling.
		expect(element.boundingBox).toHaveBeenCalledOnce();
		await hooked;
		await vi.advanceTimersByTimeAsync(8);
		await listener.onAfterCall(progress, server.onPage());

		expect(await actions.stop()).toEqual({
			version: 1,
			actions: [
				{
					pageId: "page-0",
					end: START + 8,
					method: "fill",
					inputs: [{ time: START, box: { ...BOX, y: 582 } }],
					steadyFrom: START + 8,
					steadyUntil: START + 8,
				},
			],
		});
		expect(element.boundingBox).toHaveBeenCalledOnce();
		expect(kept.dispose).toHaveBeenCalled();
	});

	describe("as a pointer call begins", () => {
		const selector = "internal:role=button";

		async function clickWith(
			frameObject: Record<string, unknown>,
			method = "click",
			params: Record<string, unknown> = { selector, strict: true },
		) {
			const server = fakeServer();
			const actions = capture();
			actions.addContext(server.context);
			const listener = server.listener();
			const progress = server.progress("call@1", method, { params });
			const kept = { boundingBox: vi.fn(async () => BOX), dispose: vi.fn() };
			const element = server.onPage({
				evaluateHandle: vi.fn(async () => kept),
				boundingBox: vi.fn(async () => BOX),
			});

			await listener.onBeforeCall(progress, server.onPage(frameObject));
			await listener.onBeforeInputAction(
				progress,
				element,
				{ x: 60, y: 40 },
				BOX,
			);
			await listener.onAfterCall(progress, server.onPage());
			return (await actions.stop())?.actions[0];
		}

		function found(box: ActionBox | null) {
			return {
				boundingBox: vi.fn(async () => box),
				dispose: vi.fn(),
			};
		}

		it("measures the element its selector finds, and lets go of it", async () => {
			const handle = found(BOX);
			const query = vi.fn(async (_target: unknown) => handle);

			const action = await clickWith({ selectors: { query } });

			expect(query).toHaveBeenCalledWith({ selector, strict: true });
			expect(handle.dispose).toHaveBeenCalled();
			expect(action?.steadySince).toBe(START);
		});

		it("finds the element the way Playwright before 1.65 wants it asked", async () => {
			const query = vi.fn(async (_selector: string, _options: unknown) =>
				found({ ...BOX, y: 1800 }),
			);

			const action = await clickWith({ selectors: { query } });

			expect(query).toHaveBeenCalledWith(selector, { strict: true });
			expect(action).not.toHaveProperty("steadySince");
			expect(action?.steadyFrom).toBe(START);
		});

		it("measures a drag's target", async () => {
			const query = vi.fn(async (_target: unknown) => found(BOX));

			await clickWith({ selectors: { query } }, "dragAndDrop", {
				source: "#card",
				target: "#lane",
			});

			expect(query).toHaveBeenCalledWith({ selector: "#lane", strict: false });
		});

		it("measures the handle of a call made on one", async () => {
			const handle = { boundingBox: vi.fn(async () => BOX) };

			const action = await clickWith(handle, "click", {});

			expect(handle.boundingBox).toHaveBeenCalledOnce();
			expect(action?.steadySince).toBe(START);
		});

		it.each([
			["no element matches yet", { selectors: { query: async () => null } }],
			[
				"the selector can't be resolved",
				{
					selectors: {
						query: async () => {
							throw new Error("strict mode violation");
						},
					},
				},
			],
			["this Playwright has no such way to find one", {}],
		])("doesn't know whether the action scrolled when %s", async (_, frame) => {
			const action = await clickWith(frame);

			expect(action).toMatchObject({ method: "click" });
			expect(action).not.toHaveProperty("steadySince");
			expect(action).not.toHaveProperty("steadyFrom");
		});

		it("doesn't look for the element of a call that sends no pointer input", async () => {
			const query = vi.fn(async (_target: unknown) => found(BOX));

			await clickWith({ selectors: { query } }, "fill");

			expect(query).not.toHaveBeenCalled();
		});
	});

	it.each(["firefox", "webkit"])(
		"doesn't say an element was in place beforehand in %s, whose frames are stamped late",
		async (browserName) => {
			const server = fakeServer(browserName);
			const actions = capture();
			actions.addContext(server.context);
			const listener = server.listener();
			const progress = server.progress("call@1", "click", {
				params: { selector: "#save" },
			});
			const handle = { boundingBox: async () => BOX, dispose: () => {} };

			await listener.onBeforeCall(
				progress,
				server.onPage({ selectors: { query: async () => handle } }),
			);
			await listener.onBeforeInputAction(
				progress,
				server.onPage({
					evaluateHandle: async () => handle,
					boundingBox: async () => BOX,
				}),
				{ x: 60, y: 40 },
				BOX,
			);
			await listener.onAfterCall(progress, server.onPage());

			const file = await actions.stop();
			expect(file?.actions[0]).toMatchObject({ steadyUntil: START });
			expect(file?.actions[0]).not.toHaveProperty("steadySince");
		},
	);

	it("takes a new viewport size as a page that changed as a whole", async () => {
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();

		await listener.onAfterCall(
			server.progress("call@1", "setViewportSize"),
			server.onPage(),
		);
		await vi.advanceTimersByTimeAsync(25);
		const progress = server.progress("call@2", "mouseClick");
		await listener.onBeforeInputAction(progress, server.onPage(), {
			x: 1,
			y: 2,
		});
		await listener.onAfterCall(progress, server.onPage());

		const file = await actions.stop();
		expect(file?.actions[0].steadyFrom).toBe(START);
	});

	it("takes a navigation as a page that changed as a whole", async () => {
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();

		actions.pageNavigated("page-0");
		await vi.advanceTimersByTimeAsync(25);
		const progress = server.progress("call@1", "mouseClick");
		await listener.onBeforeInputAction(progress, server.onPage(), {
			x: 1,
			y: 2,
		});
		await listener.onAfterCall(progress, server.onPage());

		const file = await actions.stop();
		expect(file?.actions[0].steadyFrom).toBe(START);
	});

	it("leaves out an iframe's box it can't measure in the page", async () => {
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();
		const inFrame = {
			attribution: {
				page: server.onPage().attribution.page,
				frame: { name: "child" },
			},
		};
		const progress = server.progress("call@1", "fill");

		await listener.onBeforeInputAction(progress, inFrame, undefined, BOX);
		await listener.onAfterCall(progress, inFrame);

		expect(await actions.stop()).toEqual({ version: 1, actions: [] });
	});

	it("leaves out keyboard input, internal calls and pages it doesn't capture", async () => {
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();
		const send = async (
			progress: unknown,
			sdkObject: unknown,
			point?: unknown,
			box?: unknown,
		) => {
			await listener.onBeforeInputAction(progress, sdkObject, point, box);
			await listener.onAfterCall(progress, sdkObject);
		};

		await send(server.progress("call@1", "keyboardPress"), server.onPage());
		await send(
			server.progress("call@2", "click", { internal: true }),
			server.onPage(),
			{ x: 1, y: 2 },
			BOX,
		);
		await send(
			server.progress("call@3", "click"),
			{ attribution: { page: { guid: "page@other" } } },
			{ x: 1, y: 2 },
			BOX,
		);

		expect(await actions.stop()).toEqual({ version: 1, actions: [] });
	});

	it("never records what was typed", async () => {
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();
		const progress = server.progress("call@1", "fill", {
			params: { selector: "#password", value: "hunter2" },
		});

		await listener.onBeforeInputAction(
			progress,
			server.onPage(),
			undefined,
			BOX,
		);
		await listener.onAfterCall(progress, server.onPage());

		expect(JSON.stringify(await actions.stop())).not.toContain("hunter2");
	});

	it("records nothing and warns once when the browser isn't run by this process", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const remote = { _connection: {} } as unknown as BrowserContext;

		const first = capture();
		first.addContext(remote);
		const second = capture();
		second.addContext(remote);

		expect(await first.stop()).toBeUndefined();
		expect(await second.stop()).toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toContain("actions can't be recorded");
	});

	it("gives up on a Playwright that reports its calls another way", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();

		// Playwright 1.61: (sdkObject, metadata, point, box).
		await listener.onBeforeInputAction(
			server.onPage(),
			{ id: "call@1", method: "click" },
			{ x: 1, y: 2 },
			BOX,
		);

		expect(server.listeners.size).toBe(0);
		expect(await actions.stop()).toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
	});

	it("survives a server object that throws", async () => {
		const server = fakeServer();
		const actions = capture();
		actions.addContext(server.context);
		const listener = server.listener();
		const broken = {
			get attribution(): never {
				throw new Error("gone");
			},
		};

		await expect(
			listener.onBeforeInputAction(server.progress("call@1", "click"), broken),
		).resolves.toBeUndefined();
		expect(await actions.stop()).toEqual({ version: 1, actions: [] });
	});
});

function click(callId: string) {
	return {
		callId,
		pageId: "page-0",
		method: "click",
		point: { x: 60, y: 40 },
		box: BOX,
		promptFrames: true,
	};
}

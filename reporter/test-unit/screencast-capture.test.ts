import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SCREENCAST_THROTTLE_MS,
	SCREENCAST_UNTHROTTLE_MS,
	ScreencastCapture,
	type ScreencastFrame,
	ScreencastFrameThrottle,
} from "../src/fixture/screencast-capture";
import {
	attachScreenshots,
	shouldCaptureScreenshots,
} from "../src/fixture/screenshots";
import { resolvePlaywrightOpentelemetryConfig } from "../src/shared/config";
import {
	readScreenshotsZip,
	SCREENSHOTS_ATTACHMENT_NAME,
} from "../src/shared/screenshots-zip";

describe("ScreencastFrameThrottle", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps one frame and holds its acknowledgement while throttled", async () => {
		vi.useFakeTimers();
		let now = 0;
		const kept: number[] = [];
		const throttle = new ScreencastFrameThrottle(
			(frame) => kept.push(frame.timestamp),
			() => now,
		);

		const ack = throttle.onFrame(frame(1));
		expect(ack).toBeInstanceOf(Promise);
		expect(throttle.onFrame(frame(2))).toBeUndefined();

		now = SCREENCAST_THROTTLE_MS;
		await vi.advanceTimersByTimeAsync(SCREENCAST_THROTTLE_MS);
		await expect(ack).resolves.toBeUndefined();
		throttle.onFrame(frame(3));

		expect(kept).toEqual([1, 3]);
		throttle.dispose();
	});

	it("keeps and acknowledges every frame for a while after unthrottling", () => {
		let now = 0;
		const kept: number[] = [];
		const throttle = new ScreencastFrameThrottle(
			(frame) => kept.push(frame.timestamp),
			() => now,
		);

		const pendingAck = throttle.onFrame(frame(1));
		throttle.unthrottle();
		expect(throttle.onFrame(frame(2))).toBeUndefined();
		now = SCREENCAST_UNTHROTTLE_MS - 1;
		expect(throttle.onFrame(frame(3))).toBeUndefined();
		now = SCREENCAST_UNTHROTTLE_MS;
		const throttledAck = throttle.onFrame(frame(4));
		throttle.onFrame(frame(5));

		expect(kept).toEqual([1, 2, 3, 4]);
		expect(throttledAck).toBeInstanceOf(Promise);
		throttle.dispose();
		return expect(pendingAck).resolves.toBeUndefined();
	});
});

describe("ScreencastCapture", () => {
	it("captures every page of a context with the fixture's page IDs", async () => {
		const { capture, context } = await startCapture();
		const first = context.newPage();
		capture.addContext(context.asContext());
		const second = context.newPage();

		await first.screencastStarted();
		await second.screencastStarted();
		await first.emit(frame(2000));
		await second.emit(frame(1000));

		const frames = await capture.stop();
		expect(
			frames.map(({ pageId, timestamp, file }) => ({
				pageId,
				timestamp,
				file,
			})),
		).toEqual([
			{ pageId: "page-1", timestamp: 1000, file: "page-1-1000.jpeg" },
			{ pageId: "page-0", timestamp: 2000, file: "page-0-2000.jpeg" },
		]);
		expect(await fs.readFile(frames[0].path, "utf-8")).toBe("frame-1000");
		expect(first.screencast.stops).toBe(1);

		await capture.dispose();
		expect(existsSync(capture.dir)).toBe(false);
	});

	it("keeps every frame around page API calls only", async () => {
		const { capture, context, connection } = await startCapture();
		const page = context.newPage();
		capture.addContext(context.asContext());
		await page.screencastStarted();

		await page.emit(frame(1));
		await page.emit(frame(2));
		connection.call({ _type: "APIRequestContext" });
		connection.call(page.mainFrame, { internal: true });
		await page.emit(frame(3));
		const call = connection.call(page.mainFrame);
		await page.emit(frame(4));
		await page.emit(frame(5));
		call.resolve();

		const frames = await capture.stop();
		expect(frames.map((frame) => frame.timestamp)).toEqual([1, 4, 5]);
		expect(Object.hasOwn(connection, "sendMessageToServer")).toBe(false);
		await capture.dispose();
	});

	it("keeps every frame only on the page an API call acts on", async () => {
		vi.useFakeTimers({ toFake: ["performance"] });
		try {
			const { capture, context, connection } = await startCapture();
			const acted = context.newPage();
			const background = context.newPage();
			capture.addContext(context.asContext());
			await acted.screencastStarted();
			await background.screencastStarted();
			await acted.emit(frame(1));
			await background.emit(frame(1));

			const call = connection.call({
				_type: "ElementHandle",
				_parent: acted.mainFrame,
			});
			await acted.emit(frame(2));
			await background.emit(frame(2));
			vi.advanceTimersByTime(SCREENCAST_UNTHROTTLE_MS);
			call.resolve();
			await Promise.resolve();
			await acted.emit(frame(3));
			await background.emit(frame(3));

			const frames = await capture.stop();
			expect(
				frames.map(({ pageId, timestamp }) => `${pageId}@${timestamp}`).sort(),
			).toEqual(["page-0@1", "page-0@2", "page-0@3", "page-1@1"]);
			await capture.dispose();
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps capturing with one warning when Playwright's private hooks are missing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			for (let run = 0; run < 2; run++) {
				const capture = await ScreencastCapture.start({
					playwright: {},
					pageIdFor: () => "page-0",
				});
				const context = new FakeContext();
				const page = context.newPage();
				page._wrapApiCall = undefined;
				capture.addContext(context.asContext());
				await page.screencastStarted();
				await page.emit(frame(1000 + run));

				expect(await capture.stop()).toHaveLength(1);
				await capture.dispose();
			}
			// Once for the API call hook, once for hiding internal calls.
			expect(warn).toHaveBeenCalledTimes(2);
		} finally {
			warn.mockRestore();
		}
	});

	it("lets the test run its own screencast and captures its frames", async () => {
		const { capture, context, connection } = await startCapture();
		const page = context.newPage();
		capture.addContext(context.asContext());
		await page.screencastStarted();
		const screencast = page.asPage().screencast;

		const testFrames: number[] = [];
		const disposable = await screencast.start({
			onFrame: (testFrame) => {
				testFrames.push(testFrame.timestamp);
			},
		});
		expect(page.screencast.stops).toBe(1);
		await page.emit(frame(1000));
		expect(testFrames).toEqual([1000]);

		await disposable[Symbol.asyncDispose]();
		await page.screencastStarted();
		expect(page.screencast.starts).toBe(3);
		connection.call(page);
		await page.emit(frame(2000));

		const frames = await capture.stop();
		expect(frames.map((frame) => frame.timestamp)).toEqual([1000, 2000]);
		expect(Object.hasOwn(screencast, "start")).toBe(false);
		await capture.dispose();
	});
});

describe("screenshots attachment", () => {
	const config = resolvePlaywrightOpentelemetryConfig({
		playwrightTraceApiEndpoint: { url: "https://trace-api.example.com" },
	});

	it("captures only when a destination could keep the test", () => {
		const testInfo = { retry: 0 } as TestInfo;
		expect(shouldCaptureScreenshots(config, { trace: "on", testInfo })).toBe(
			true,
		);
		expect(
			shouldCaptureScreenshots(config, { trace: "on-first-retry", testInfo }),
		).toBe(false);
		expect(
			shouldCaptureScreenshots(
				resolvePlaywrightOpentelemetryConfig({
					otlpEndpoint: { url: "https://otel.example.com" },
				}),
				{ trace: "on", testInfo },
			),
		).toBe(false);
		expect(
			shouldCaptureScreenshots(
				resolvePlaywrightOpentelemetryConfig({
					playwrightTraceApiEndpoint: { url: "https://trace-api.example.com" },
					screenshots: false,
				}),
				{ trace: "on", testInfo },
			),
		).toBe(false);
	});

	it("attaches the captured frames as a screenshots ZIP when the test is kept", async () => {
		const { capture, context } = await startCapture();
		const page = context.newPage();
		capture.addContext(context.asContext());
		await page.screencastStarted();
		await page.emit({
			...frame(1000),
			viewportWidth: 1280,
			viewportHeight: 720,
		});

		const attached: Array<{ name: string; zip: Blob }> = [];
		const attach = vi.fn(async (name: string, options: { path: string }) => {
			attached.push({
				name,
				zip: new Blob([await fs.readFile(options.path)]),
			});
		});
		await attachScreenshots(capture, config, {
			trace: "retain-on-failure",
			testInfo: { attach, retry: 0, status: "failed" } as unknown as TestInfo,
		});

		expect(attached.map(({ name }) => name)).toEqual([
			SCREENSHOTS_ATTACHMENT_NAME,
		]);
		expect(await readScreenshotsZip(attached[0].zip)).toEqual([
			expect.objectContaining({
				pageId: "page-0",
				timestamp: 1000,
				file: "page-0-1000.jpeg",
				viewportWidth: 1280,
				viewportHeight: 720,
			}),
		]);
		expect(existsSync(capture.dir)).toBe(false);
	});

	it("drops the frames when the test isn't kept", async () => {
		const { capture, context } = await startCapture();
		const page = context.newPage();
		capture.addContext(context.asContext());
		await page.screencastStarted();
		await page.emit(frame(1000));

		const attach = vi.fn();
		await attachScreenshots(capture, config, {
			trace: "retain-on-failure",
			testInfo: { attach, retry: 0, status: "passed" } as unknown as TestInfo,
		});

		expect(attach).not.toHaveBeenCalled();
		expect(existsSync(capture.dir)).toBe(false);
	});
});

function frame(timestamp: number): ScreencastFrame {
	return { data: Buffer.from(`frame-${timestamp}`), timestamp };
}

async function startCapture() {
	const connection = new FakeConnection();
	const pageIds = new Map<Page, string>();
	const capture = await ScreencastCapture.start({
		playwright: { _connection: connection },
		pageIdFor: (page) => {
			const pageId = pageIds.get(page) ?? `page-${pageIds.size}`;
			pageIds.set(page, pageId);
			return pageId;
		},
	});
	return { capture, context: new FakeContext(), connection };
}

type FrameCallback = (frame: ScreencastFrame) => unknown;

class FakeScreencast {
	starts = 0;
	stops = 0;
	onFrame?: FrameCallback;

	async start(options: { onFrame?: FrameCallback } = {}) {
		if (this.onFrame) {
			throw new Error("Screencast is already started");
		}
		this.starts += 1;
		this.onFrame = options.onFrame ?? (() => {});
		// Like Playwright's DisposableStub, disposing calls the instance's stop().
		return { [Symbol.asyncDispose]: () => this.stop() };
	}

	async stop() {
		this.stops += 1;
		this.onFrame = undefined;
	}
}

class FakePage {
	readonly _type = "Page";
	readonly screencast = new FakeScreencast();
	readonly mainFrame = { _type: "Frame", _page: this };

	/** Playwright's private hook for running calls as internal ones. */
	_wrapApiCall?: <T>(call: () => Promise<T>) => Promise<T> = (call) => call();

	asPage(): Page {
		return this as unknown as Page;
	}

	isClosed(): boolean {
		return false;
	}

	async screencastStarted(): Promise<void> {
		await vi.waitFor(() => expect(this.screencast.onFrame).toBeDefined());
	}

	async emit(screencastFrame: ScreencastFrame): Promise<void> {
		// Like Playwright, deliver the frame but don't wait for a held-back ack.
		void this.screencast.onFrame?.(screencastFrame);
		await new Promise((resolve) => setImmediate(resolve));
	}
}

class FakeContext extends EventEmitter {
	private readonly openPages: FakePage[] = [];

	asContext(): BrowserContext {
		return this as unknown as BrowserContext;
	}

	pages(): Page[] {
		return this.openPages.map((page) => page.asPage());
	}

	newPage(): FakePage {
		const page = new FakePage();
		this.openPages.push(page);
		this.emit("page", page.asPage());
		return page;
	}
}

/** Stands in for the client connection every Playwright API call goes through. */
class FakeConnection {
	async sendMessageToServer(
		_object: unknown,
		_method: string,
		_params: unknown,
		options: { internal?: boolean; reply: Promise<void> },
	): Promise<void> {
		await options.reply;
	}

	/** Sends an API call on `object` and returns a way to finish it. */
	call(object: object, options: { internal?: boolean } = {}) {
		let resolve!: () => void;
		const reply = new Promise<void>((r) => {
			resolve = r;
		});
		void this.sendMessageToServer(object, "method", {}, { ...options, reply });
		return { resolve };
	}
}

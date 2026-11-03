import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

// Same rhythm as Playwright's own trace recorder (ScreencastTracingRecorder):
// about 5 frames per second, and every frame for a short while around each
// page action.
export const SCREENCAST_THROTTLE_MS = 200;
export const SCREENCAST_UNTHROTTLE_MS = 500;
// Without Playwright's API call hooks, the first frame after a quiet page is
// the best signal that an action just changed something.
export const SCREENCAST_QUIET_GAP_MS = 1000;

// API calls on these objects act on a page, so Playwright's trace recorder
// stops throttling that page's screencast around them.
const PAGE_CHANNEL_TYPES = new Set([
	"Page",
	"Frame",
	"ElementHandle",
	"JSHandle",
]);
// The page of a page API call that couldn't be resolved, such as a handle in a
// worker: every page's throttling stops.
const UNKNOWN_PAGE = Symbol("unknown page");

export interface ScreencastFrame {
	data: Buffer;
	timestamp: number;
	viewportWidth?: number;
	viewportHeight?: number;
}

export interface CapturedFrame {
	pageId: string;
	timestamp: number;
	file: string;
	path: string;
	viewportWidth?: number;
	viewportHeight?: number;
}

type ScreencastStartOptions = NonNullable<
	Parameters<Page["screencast"]["start"]>[0]
>;

interface ClientConnection {
	sendMessageToServer(
		object: unknown,
		method: string,
		params: unknown,
		options?: { internal?: boolean },
	): Promise<unknown>;
}

/**
 * Decides which screencast frames to keep, mirroring Playwright's trace
 * recorder. Normally it keeps one frame and holds back its acknowledgement for
 * SCREENCAST_THROTTLE_MS, so the browser slows down and frames that still
 * arrive in between are dropped. For SCREENCAST_UNTHROTTLE_MS after
 * `unthrottle()`, it keeps and acknowledges every frame.
 */
export class ScreencastFrameThrottle {
	private unthrottledUntil = Number.NEGATIVE_INFINITY;
	private pendingAck?: { resolve: () => void; timer: NodeJS.Timeout };

	constructor(
		private readonly keep: (frame: ScreencastFrame) => void,
		private readonly now: () => number = () => performance.now(),
	) {}

	onFrame(frame: ScreencastFrame): Promise<void> | undefined {
		if (this.now() < this.unthrottledUntil) {
			this.keep(frame);
			return;
		}
		if (this.pendingAck) {
			return;
		}

		this.keep(frame);
		return new Promise<void>((resolve) => {
			this.pendingAck = {
				resolve,
				timer: setTimeout(() => this.clearPendingAck(), SCREENCAST_THROTTLE_MS),
			};
		});
	}

	unthrottle(): void {
		this.unthrottledUntil = this.now() + SCREENCAST_UNTHROTTLE_MS;
		this.clearPendingAck();
	}

	dispose(): void {
		this.unthrottledUntil = Number.NEGATIVE_INFINITY;
		this.clearPendingAck();
	}

	private clearPendingAck(): void {
		if (!this.pendingAck) {
			return;
		}
		clearTimeout(this.pendingAck.timer);
		this.pendingAck.resolve();
		this.pendingAck = undefined;
	}
}

/**
 * Captures screencast frames from every page opened during a test and writes
 * the kept frames to a temporary directory.
 */
export class ScreencastCapture {
	private readonly pages = new Map<Page, PageScreencast>();
	private readonly contexts = new Map<BrowserContext, (page: Page) => void>();
	private readonly frames: CapturedFrame[] = [];
	private readonly writes = new Set<Promise<void>>();
	private readonly files = new Set<string>();
	private readonly apiCalls: PageApiCallHook | undefined;
	private stopped = false;

	private constructor(
		readonly dir: string,
		private readonly pageIdFor: (page: Page) => string,
		playwright: unknown,
	) {
		this.apiCalls = PageApiCallHook.install(playwright, (page) =>
			this.unthrottle(page),
		);
		if (!this.apiCalls) {
			warnOnce(
				"api-calls",
				"playwright-opentelemetry: this Playwright version doesn't expose the API call hook screenshots use. Screenshots are still captured, but actions are detected from page activity, so fewer frames are kept around them.",
			);
		}
	}

	/**
	 * Contexts are added by the caller with `addContext`.
	 *
	 * @param playwright The `playwright` fixture. Its private connection shows
	 * which page each API call acts on; without it, activity is detected from
	 * the frames.
	 */
	static async start(options: {
		playwright: unknown;
		pageIdFor: (page: Page) => string;
	}): Promise<ScreencastCapture> {
		const dir = await fs.mkdtemp(
			path.join(os.tmpdir(), "playwright-opentelemetry-screencast-"),
		);
		return new ScreencastCapture(dir, options.pageIdFor, options.playwright);
	}

	addContext(context: BrowserContext): void {
		if (this.stopped || this.contexts.has(context)) {
			return;
		}

		const onPage = (page: Page) => this.addPage(page);
		this.contexts.set(context, onPage);
		context.on("page", onPage);
		for (const page of context.pages()) {
			this.addPage(page);
		}
	}

	addPage(page: Page): void {
		if (this.stopped || this.pages.has(page)) {
			return;
		}

		let screencast: PageScreencast;
		try {
			const pageId = this.pageIdFor(page);
			screencast = new PageScreencast(
				page,
				(frame) => this.keepFrame(pageId, frame),
				{ detectActivityFromFrames: !this.apiCalls },
			);
		} catch (error) {
			// Runs inside Playwright's "page" event; a missing page's screenshots
			// must never fail the test.
			console.warn(`Failed to capture screenshots of a page: ${error}`);
			return;
		}
		this.pages.set(page, screencast);
		void screencast.start();
	}

	/** Stops capturing and returns the kept frames, oldest first. */
	async stop(): Promise<CapturedFrame[]> {
		if (!this.stopped) {
			this.stopped = true;
			this.apiCalls?.uninstall();
			for (const [context, onPage] of this.contexts) {
				context.off("page", onPage);
			}
			await Promise.all(
				Array.from(this.pages.values(), (screencast) => screencast.stop()),
			);
		}

		await Promise.all(this.writes);
		return [...this.frames].sort((a, b) => a.timestamp - b.timestamp);
	}

	async dispose(): Promise<void> {
		await this.stop();
		await fs.rm(this.dir, { recursive: true, force: true });
	}

	private unthrottle(page: object | typeof UNKNOWN_PAGE): void {
		if (page !== UNKNOWN_PAGE) {
			this.pages.get(page as Page)?.unthrottle();
			return;
		}
		for (const screencast of this.pages.values()) {
			screencast.unthrottle();
		}
	}

	private keepFrame(pageId: string, frame: ScreencastFrame): void {
		if (this.stopped) {
			return;
		}

		const timestamp = Math.round(
			Number.isFinite(frame.timestamp) ? frame.timestamp : Date.now(),
		);
		const file = this.uniqueFileName(pageId, timestamp);
		const framePath = path.join(this.dir, file);
		const write = fs.writeFile(framePath, frame.data).then(
			() => {
				this.frames.push({
					pageId,
					timestamp,
					file,
					path: framePath,
					...viewportOf(frame),
				});
			},
			() => {
				// Missing a frame is acceptable; the next one shows the same page.
			},
		);
		this.writes.add(write);
		void write.then(() => this.writes.delete(write));
	}

	private uniqueFileName(pageId: string, timestamp: number): string {
		let file = `${pageId}-${timestamp}.jpeg`;
		for (let index = 1; this.files.has(file); index++) {
			file = `${pageId}-${timestamp}-${index}.jpeg`;
		}
		this.files.add(file);
		return file;
	}
}

/**
 * Owns the screencast of one page. Playwright allows one `page.screencast`
 * per page, so the test's own `start()`/`stop()` calls are routed through here:
 * while the test runs its screencast, frames are taken from it instead.
 */
class PageScreencast {
	private readonly throttle: ScreencastFrameThrottle;
	private readonly originalStart: Page["screencast"]["start"];
	private readonly originalStop: Page["screencast"]["stop"];
	private ownStarted = false;
	private userStarted = false;
	private stopped = false;
	private lastFrameAt?: number;
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly page: Page,
		keep: (frame: ScreencastFrame) => void,
		private readonly options: { detectActivityFromFrames: boolean },
	) {
		this.throttle = new ScreencastFrameThrottle(keep);

		const screencast = page.screencast;
		this.originalStart = screencast.start.bind(screencast);
		this.originalStop = screencast.stop.bind(screencast);
		screencast.start = (startOptions) => this.startForTest(startOptions);
		screencast.stop = () => this.stopForTest();
	}

	start(): Promise<void> {
		return this.enqueue(() => this.startOwn());
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.throttle.dispose();
		await this.enqueue(() => this.stopOwn());

		const screencast = this.page.screencast as Partial<Page["screencast"]>;
		delete screencast.start;
		delete screencast.stop;
	}

	unthrottle(): void {
		this.throttle.unthrottle();
	}

	private handleFrame(frame: ScreencastFrame): Promise<void> | undefined {
		if (this.options.detectActivityFromFrames) {
			const now = performance.now();
			if (
				this.lastFrameAt === undefined ||
				now - this.lastFrameAt > SCREENCAST_QUIET_GAP_MS
			) {
				this.throttle.unthrottle();
			}
			this.lastFrameAt = now;
		}
		return this.throttle.onFrame(frame);
	}

	private async startOwn(): Promise<void> {
		if (
			this.stopped ||
			this.ownStarted ||
			this.userStarted ||
			this.page.isClosed()
		) {
			return;
		}

		try {
			await runInternalApiCall(this.page, () =>
				this.originalStart({ onFrame: (frame) => this.handleFrame(frame) }),
			);
			this.ownStarted = true;
		} catch {
			// The page closed while starting; there is nothing left to capture.
		}
	}

	private async stopOwn(): Promise<void> {
		if (!this.ownStarted) {
			return;
		}

		this.ownStarted = false;
		await runInternalApiCall(this.page, () => this.originalStop()).catch(
			() => {},
		);
	}

	private async startForTest(
		options: ScreencastStartOptions = {},
	): ReturnType<Page["screencast"]["start"]> {
		await this.enqueue(() => this.stopOwn());
		this.userStarted = true;

		const onFrame = options.onFrame;
		try {
			return await this.originalStart({
				...options,
				onFrame: (frame) => {
					// The test's callback decides when frames are acknowledged.
					void this.handleFrame(frame);
					return onFrame?.(frame);
				},
			});
		} catch (error) {
			this.userStarted = false;
			await this.start();
			throw error;
		}
	}

	private async stopForTest(): Promise<void> {
		if (!this.userStarted) {
			return;
		}

		try {
			await this.originalStop();
		} finally {
			this.userStarted = false;
			await this.start();
		}
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		const next = this.queue.then(task);
		this.queue = next.catch(() => {});
		return next;
	}
}

/**
 * Sees which page each Playwright API call acts on, so only that page's
 * throttling stops around it, like Playwright's trace recorder does on the
 * server. The client instrumentation reports API calls without their object,
 * so this wraps the private connection method every call goes through instead.
 * Only the first message of a test-facing API call is sent as non-internal:
 * the same call @playwright/test reports as a step.
 */
class PageApiCallHook {
	private constructor(
		private readonly connection: ClientConnection,
		private readonly wrapper: ClientConnection["sendMessageToServer"],
		private readonly original: ClientConnection["sendMessageToServer"],
		private readonly hadOwnMethod: boolean,
	) {}

	static install(
		playwright: unknown,
		onPageApiCall: (page: object | typeof UNKNOWN_PAGE) => void,
	): PageApiCallHook | undefined {
		const connection = (playwright as { _connection?: unknown } | null)
			?._connection as Partial<ClientConnection> | undefined;
		const original = connection?.sendMessageToServer;
		if (!connection || typeof original !== "function") {
			return undefined;
		}

		const wrapper: ClientConnection["sendMessageToServer"] = function (
			this: unknown,
			object,
			method,
			params,
			options,
		) {
			const result = original.call(this, object, method, params, options);
			const page = options?.internal ? undefined : pageOfApiCall(object);
			if (page) {
				onPageApiCall(page);
				const onEnd = () => onPageApiCall(page);
				void result.then(onEnd, onEnd);
			}
			return result;
		};
		const hadOwnMethod = Object.hasOwn(connection, "sendMessageToServer");
		connection.sendMessageToServer = wrapper;
		return new PageApiCallHook(
			connection as ClientConnection,
			wrapper,
			original,
			hadOwnMethod,
		);
	}

	uninstall(): void {
		// Another wrapper installed after this one would be lost by restoring.
		if (this.connection.sendMessageToServer !== this.wrapper) {
			return;
		}
		if (this.hadOwnMethod) {
			this.connection.sendMessageToServer = this.original;
		} else {
			delete (this.connection as Partial<ClientConnection>).sendMessageToServer;
		}
	}
}

/**
 * The page a call on a Playwright client object acts on: the page itself, a
 * frame's page, or the page of the frame that owns a handle.
 */
function pageOfApiCall(
	object: unknown,
): object | typeof UNKNOWN_PAGE | undefined {
	const channelOwner = object as {
		_type?: string;
		_parent?: { _type?: string; _page?: object };
		_page?: object;
	} | null;
	const type = channelOwner?._type ?? "";
	if (!PAGE_CHANNEL_TYPES.has(type)) {
		return undefined;
	}
	if (type === "Page") {
		return channelOwner as object;
	}
	const frame = type === "Frame" ? channelOwner : channelOwner?._parent;
	return (frame?._type === "Frame" && frame._page) || UNKNOWN_PAGE;
}

/**
 * Runs Playwright calls as internal ones, so they aren't reported as test
 * steps or seen by the API call hooks.
 */
function runInternalApiCall<T>(page: Page, call: () => Promise<T>): Promise<T> {
	const wrapApiCall = (
		page as unknown as {
			_wrapApiCall?: (
				call: () => Promise<T>,
				options: { internal: boolean },
			) => Promise<T>;
		}
	)._wrapApiCall;

	if (typeof wrapApiCall === "function") {
		return wrapApiCall.call(page, call, { internal: true });
	}
	warnOnce(
		"internal-calls",
		"playwright-opentelemetry: this Playwright version can't hide the screencast calls screenshots use, so they may show up as test steps.",
	);
	return call();
}

function viewportOf(
	frame: ScreencastFrame,
): Pick<CapturedFrame, "viewportWidth" | "viewportHeight"> {
	const { viewportWidth, viewportHeight } = frame;
	return Number.isFinite(viewportWidth) && Number.isFinite(viewportHeight)
		? { viewportWidth, viewportHeight }
		: {};
}

const warnings = new Set<string>();

/** Warns once per worker: the same fallback applies to every test. */
function warnOnce(key: string, message: string): void {
	if (warnings.has(key)) {
		return;
	}
	warnings.add(key);
	console.warn(message);
}

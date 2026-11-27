import type { BrowserContext } from "@playwright/test";
import type {
	ActionBox,
	ActionPoint,
	ActionsFile,
	RecordedAction,
} from "../shared/screenshots-zip";
import { warnOnce } from "./warn-once";

/** How long stopping waits for post-call element measurements still in flight */
const SETTLE_TIMEOUT_MS = 500;

/**
 * An element handle kept from `onBeforeInputAction` until `onAfterCall` so
 * non-pointer actions (`fill`, `selectOption`, `press`, ...) can be measured
 * once after focus-scroll and in main-viewport coordinates.
 */
export interface ActionElement {
	/** Its box in the page's main viewport, or null when it has none */
	measure(): Promise<ActionBox | null>;
	release(): void;
}

export interface ActionInputEvent {
	callId: string;
	pageId: string;
	method: string;
	point?: ActionPoint;
	box?: ActionBox;
	/** The box from Playwright is relative to an iframe, not the main viewport */
	boxInChildFrame?: boolean;
	/** Only provided for non-pointer element actions that need one post-call measure */
	element?: ActionElement;
}

interface OpenCall {
	id: string;
	pageId: string;
	method: string;
	start: number;
	end?: number;
	failed: boolean;
	point?: ActionPoint;
	box?: ActionBox;
	boxInChildFrame: boolean;
	/** Source point of a drag, captured on the first input before the drop target */
	firstPoint?: ActionPoint;
	inputCount: number;
	element?: ActionElement;
}

/**
 * Records what each input action did and when it ran, from its first input
 * (`start`) to the end of its call (`end`). Nothing here blocks Playwright's
 * calls.
 */
export class ActionRecorder {
	private readonly open = new Map<string, OpenCall>();
	private readonly ended: OpenCall[] = [];
	private readonly pending = new Set<Promise<void>>();
	private stopped = false;

	constructor(private readonly now: () => number = () => Date.now()) {}

	/** Playwright is about to send input for a call; fires again on each retry. */
	input(event: ActionInputEvent): void {
		if (this.stopped) {
			event.element?.release();
			return;
		}
		if (!event.point && !event.box) {
			event.element?.release();
			return;
		}

		let call = this.open.get(event.callId);
		if (!call) {
			call = {
				id: event.callId,
				pageId: event.pageId,
				method: event.method,
				// Not when the call began: it may wait a long time for its element,
				// and nothing has happened where its input lands until it's sent.
				start: this.now(),
				failed: false,
				boxInChildFrame: false,
				inputCount: 0,
			};
			this.open.set(event.callId, call);
		} else {
			// Earlier retry or source end of a drag: release the previous handle.
			call.element?.release();
			call.element = undefined;
		}

		const point = event.point ? roundPoint(event.point) : undefined;
		const box = event.box ? roundBox(event.box) : undefined;
		if (call.inputCount === 0 && point) {
			call.firstPoint = point;
		}
		call.inputCount += 1;
		call.point = point;
		call.box = box;
		call.boxInChildFrame = event.boxInChildFrame === true;
		call.element = event.element;
	}

	callEnded(callId: string, failed: boolean): void {
		const call = this.open.get(callId);
		if (!call || this.stopped) {
			return;
		}
		this.open.delete(callId);
		call.end = Math.max(call.start, this.now());
		call.failed = failed;
		this.ended.push(call);

		const element = call.element;
		call.element = undefined;
		if (!element) {
			return;
		}
		// Non-pointer actions (`fill`, `press`, ...) fire `onBeforeInputAction`
		// before focusing (which can scroll) and with iframe-local boxes. Measure
		// once now that the call has finished, then release the handle.
		const measure = element
			.measure()
			.then(
				(box) => {
					if (box) {
						call.box = roundBox(box);
						call.boxInChildFrame = false;
					}
				},
				() => {
					// The element or page may already be gone; keep the fallback box.
				},
			)
			.finally(() => {
				element.release();
				this.pending.delete(measure);
			});
		this.pending.add(measure);
	}

	/**
	 * Stops recording and returns the actions of completed calls, ordered by
	 * start time.
	 */
	async finish(): Promise<RecordedAction[]> {
		this.stopped = true;
		for (const call of this.open.values()) {
			call.element?.release();
			call.element = undefined;
		}
		this.open.clear();

		if (this.pending.size > 0) {
			let timeout: NodeJS.Timeout | undefined;
			await Promise.race([
				Promise.all(this.pending),
				new Promise<void>((resolve) => {
					timeout = setTimeout(resolve, SETTLE_TIMEOUT_MS);
					timeout.unref();
				}),
			]);
			clearTimeout(timeout);
		}

		return this.ended
			.flatMap((call) => toRecordedAction(call) ?? [])
			.sort((a, b) => a.start - b.start);
	}
}

function toRecordedAction(call: OpenCall): RecordedAction | undefined {
	if (call.end === undefined) {
		return undefined;
	}
	const box = call.boxInChildFrame ? undefined : call.box;
	if (!call.point && !box) {
		return undefined;
	}
	const dragFrom =
		call.method === "dragAndDrop" && call.inputCount > 1 && call.point
			? call.firstPoint
			: undefined;
	return {
		pageId: call.pageId,
		start: call.start,
		end: call.end,
		method: call.method,
		...(call.point ? { point: call.point } : {}),
		...(box ? { box } : {}),
		...(dragFrom ? { dragFrom } : {}),
		...(call.failed ? { failed: true } : {}),
	};
}

/** A call as Playwright's server instrumentation reports it. */
export interface ServerCall {
	id: string;
	method: string;
	/** Not one the test made, such as this fixture's own screencast calls */
	internal: boolean;
	failed: boolean;
	sdkObject: ServerObject;
}

interface ServerObject {
	attribution: {
		page?: { guid?: unknown; mainFrame?: unknown };
		frame?: unknown;
	};
	evaluateHandle?: unknown;
	boundingBox?: unknown;
}

/**
 * Reads the arguments Playwright's server instrumentation gives its listeners:
 * `(progress, sdkObject, ...)` since Playwright 1.63. Returns undefined for
 * any other shape, such as older versions.
 */
export function parseServerCall(args: unknown[]): ServerCall | undefined {
	const [progress, sdkObject] = args;
	const metadata = isRecord(progress) ? progress.metadata : undefined;
	if (
		!isRecord(metadata) ||
		typeof metadata.id !== "string" ||
		typeof metadata.method !== "string" ||
		!isRecord(sdkObject) ||
		!isRecord(sdkObject.attribution)
	) {
		return undefined;
	}
	return {
		id: metadata.id,
		method: metadata.method,
		internal: metadata.internal === true,
		failed: metadata.error !== undefined && metadata.error !== null,
		sdkObject: sdkObject as unknown as ServerObject,
	};
}

type ServerListener = Record<
	"onBeforeInputAction" | "onAfterCall",
	(...args: unknown[]) => Promise<void>
>;

interface ServerInstrumentation {
	addListener(listener: ServerListener, context: unknown): void;
	removeListener(listener: ServerListener): void;
}

/** Playwright awaits its listeners in turn, so none of them may take time. */
const DONE = Promise.resolve();

/** Minimal progress shim for Playwright's server `ElementHandle.boundingBox`. */
const NO_PROGRESS = {
	timeout: 0,
	deadline: 0,
	metadata: {},
	signal: new AbortController().signal,
	disableTimeout() {},
	log() {},
	setAllowConcurrentOrNestedRaces() {},
	race<T>(promise: Promise<T> | Promise<T>[]): Promise<T> {
		return Array.isArray(promise) ? Promise.race(promise) : promise;
	},
	wait(timeout: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, timeout));
	},
};

/**
 * Records where a test's actions landed on its pages: the point clicked, the
 * element filled. Playwright's server works that out for every action and
 * notifies its instrumentation listeners just before sending the input.
 * In `@playwright/test` the server runs in the test's own process, so the
 * fixture listens in without making any call wait. With a remote browser there
 * is no in-process server and nothing is recorded.
 */
export class ActionCapture {
	private readonly recorder = new ActionRecorder();
	private readonly listeners: Array<{
		instrumentation: ServerInstrumentation;
		listener: ServerListener;
	}> = [];
	private stopped = false;
	private unsupported = false;

	/**
	 * @param pageIdFor The `browser.page.id` of the page with a Playwright guid,
	 * or undefined for a page that isn't being captured.
	 */
	constructor(
		private readonly pageIdFor: (pageGuid: string) => string | undefined,
	) {}

	addContext(context: BrowserContext): void {
		if (this.stopped || this.unsupported) {
			return;
		}
		try {
			const instrumentation = serverInstrumentationOf(context);
			if (!instrumentation) {
				warnOnce(
					"actions",
					"playwright-opentelemetry: the test's actions can't be recorded for the trace viewer to highlight, because the browser isn't run by this process's Playwright or this Playwright version doesn't expose its instrumentation. Screenshots are still captured.",
				);
				return;
			}
			const listener = this.createListener();
			instrumentation.server.addListener(listener, instrumentation.context);
			this.listeners.push({
				instrumentation: instrumentation.server,
				listener,
			});
		} catch {
			// Actions are an extra; the test and its screenshots carry on.
		}
	}

	/**
	 * Stops recording. Undefined when nothing could be recorded, as opposed to a
	 * test that did nothing to its pages.
	 */
	async stop(): Promise<ActionsFile | undefined> {
		this.stopped = true;
		const listened = this.listeners.length > 0;
		this.removeListeners();
		const actions = await this.recorder.finish();
		return listened && !this.unsupported ? { version: 1, actions } : undefined;
	}

	private removeListeners(): void {
		for (const { instrumentation, listener } of this.listeners.splice(0)) {
			try {
				instrumentation.removeListener(listener);
			} catch {
				// The browser may already be gone.
			}
		}
	}

	private createListener(): ServerListener {
		const listen =
			(handle: (call: ServerCall, args: unknown[]) => void) =>
			(...args: unknown[]): Promise<void> => {
				try {
					const call = parseServerCall(args);
					if (call) {
						handle(call, args);
					} else {
						this.giveUp();
					}
				} catch {
					// Never let a test fail or wait over this.
				}
				return DONE;
			};
		return {
			onBeforeInputAction: listen((call, args) => {
				this.recordInput(call, args[2], args[3]);
			}),
			onAfterCall: listen((call) => {
				this.recorder.callEnded(call.id, call.failed);
			}),
		};
	}

	private recordInput(
		call: ServerCall,
		pointArg: unknown,
		boxArg: unknown,
	): void {
		const pageId = this.pageIdOf(call);
		const point = parsePoint(pointArg);
		const box = parseBox(boxArg);
		// Keyboard-only input has nowhere to draw.
		if (!pageId || call.internal || (!point && !box)) {
			return;
		}
		this.recorder.input({
			callId: call.id,
			pageId,
			method: call.method,
			point,
			box,
			// Pointer input is already measured in the main viewport after scroll;
			// non-pointer element input (`fill`, `press`, ...) is measured once at
			// `onAfterCall` so focus-scroll and iframe offsets are accounted for.
			boxInChildFrame: !point && !isInMainFrame(call.sdkObject),
			element: point ? undefined : elementOf(call.sdkObject),
		});
	}

	private pageIdOf(call: ServerCall): string | undefined {
		const guid = call.sdkObject.attribution.page?.guid;
		return typeof guid === "string" ? this.pageIdFor(guid) : undefined;
	}

	private giveUp(): void {
		if (this.unsupported) {
			return;
		}
		this.unsupported = true;
		this.removeListeners();
		warnOnce(
			"actions-shape",
			"playwright-opentelemetry: this Playwright version reports its actions in a way this version of playwright-opentelemetry doesn't know, so they aren't recorded for the trace viewer to highlight. Screenshots are still captured.",
		);
	}
}

/**
 * The server's instrumentation and its object for a context. Only an
 * in-process Playwright can hand over its server objects.
 */
function serverInstrumentationOf(
	context: BrowserContext,
): { server: ServerInstrumentation; context: unknown } | undefined {
	const toImpl = (
		context as unknown as {
			_connection?: { toImpl?: (object: unknown) => unknown };
		}
	)._connection?.toImpl;
	if (typeof toImpl !== "function") {
		return undefined;
	}
	const serverContext = toImpl(context);
	const instrumentation = isRecord(serverContext)
		? serverContext.instrumentation
		: undefined;
	if (
		!isRecord(instrumentation) ||
		typeof instrumentation.addListener !== "function" ||
		typeof instrumentation.removeListener !== "function"
	) {
		return undefined;
	}
	return {
		server: instrumentation as unknown as ServerInstrumentation,
		context: serverContext,
	};
}

function isInMainFrame(sdkObject: ServerObject): boolean {
	const { page, frame } = sdkObject.attribution;
	if (!frame || typeof page?.mainFrame !== "function") {
		return false;
	}
	return page.mainFrame() === frame;
}

/**
 * Runs in the page. Playwright disposes its own handle when a call ends, so
 * this clones it until we take our single post-call measurement.
 */
const keepElement = (element: unknown) => element;

function elementOf(sdkObject: ServerObject): ActionElement | undefined {
	const { evaluateHandle, boundingBox } = sdkObject;
	if (
		typeof evaluateHandle !== "function" ||
		typeof boundingBox !== "function"
	) {
		return undefined;
	}

	type Handle = {
		boundingBox(progress: unknown): Promise<unknown>;
		dispose?(): void;
	};
	let kept: Promise<Handle>;
	try {
		kept = Promise.resolve(evaluateHandle.call(sdkObject, keepElement));
	} catch {
		return undefined;
	}
	// The page can go away at any moment.
	kept.catch(() => {});
	return {
		measure: async () =>
			parseBox(await (await kept).boundingBox(NO_PROGRESS)) ?? null,
		release: () => {
			void kept.then(
				(handle) => handle.dispose?.(),
				() => {},
			);
		},
	};
}

function roundPoint(point: ActionPoint): ActionPoint {
	return { x: round(point.x), y: round(point.y) };
}

function roundBox(box: ActionBox): ActionBox {
	return {
		x: round(box.x),
		y: round(box.y),
		width: round(box.width),
		height: round(box.height),
	};
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function parsePoint(value: unknown): ActionPoint | undefined {
	return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
		? { x: value.x, y: value.y }
		: undefined;
}

function parseBox(value: unknown): ActionBox | undefined {
	return isRecord(value) &&
		isFiniteNumber(value.x) &&
		isFiniteNumber(value.y) &&
		isFiniteNumber(value.width) &&
		isFiniteNumber(value.height)
		? { x: value.x, y: value.y, width: value.width, height: value.height }
		: undefined;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

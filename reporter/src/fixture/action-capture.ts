import type { BrowserContext } from "@playwright/test";
import type {
	ActionBox,
	ActionInput,
	ActionPoint,
	ActionsFile,
	RecordedAction,
} from "../shared/screenshots-zip";
import { warnOnce } from "./warn-once";

/**
 * How long after a call its element is still measured. A highlight is only
 * drawn on frames from a time the element was seen to be in the same place,
 * so this is the longest one stays up while the page keeps changing.
 */
export const ACTION_WATCH_MS = 500;
/** A page that animates takes a frame every few milliseconds. */
export const ACTION_MIN_CHECK_GAP_MS = 10;
/** A call can wait a long time after its input, for a navigation say. */
export const ACTION_MAX_CHECKS = 60;
/** Boxes this close are the same place: layout rounds differently per frame. */
const SAME_PLACE_TOLERANCE_PX = 1;
/** How long stopping waits for measurements still on their way */
const SETTLE_TIMEOUT_MS = 500;

/** An element that input was sent to, kept so it can be measured again. */
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
	/** The box can't be used as it is: it's relative to an iframe */
	boxInChildFrame?: boolean;
	element?: ActionElement;
	/**
	 * The page's frames are stamped with the time they were shown, so a frame
	 * from after an element was measured shows it as measured.
	 */
	promptFrames?: boolean;
}

interface RecordedInput extends ActionInput {
	boxInChildFrame?: boolean;
}

interface Call {
	id: string;
	pageId: string;
	method: string;
	inputs: RecordedInput[];
	end?: number;
	failed: boolean;
	/** Watches the element of the last input */
	watch?: ElementWatch;
	/** Where the call's element was when the call began, if that was asked */
	before?: Before;
	/** When the page last changed as a whole before the last input */
	pageChangedAt?: number;
	promptFrames: boolean;
}

/** Where a call's element was as the call began, and when that was. */
interface Before {
	at: number;
	place: Promise<ActionBox | undefined>;
}

/**
 * Measures an element again and again to learn how long it stays where it
 * was first measured.
 */
class ElementWatch {
	/** The last time the element was known to be in place */
	steadyUntil: number;
	/** When the element was found to have moved to its place, if it did */
	steadyFrom?: number;
	/**
	 * When the element was first measured in its place, if that was before
	 * the action could have moved it
	 */
	steadySince?: number;
	timer?: NodeJS.Timeout;
	/** A check put off because the last one was a moment ago */
	private later?: NodeJS.Timeout;
	private place?: ActionBox;
	private started = false;
	private over = false;
	private checks = 0;
	private lastCheckAt = Number.NEGATIVE_INFINITY;
	/** Measurements are handled in the order they were asked for */
	private handled: Promise<void> = Promise.resolve();

	constructor(
		private readonly element: ActionElement,
		private readonly now: () => number,
		private readonly since: number,
	) {
		this.steadyUntil = since;
	}

	get watching(): boolean {
		return this.started && !this.over;
	}

	/**
	 * Takes the element's place from where it is now; `onPlace` hears it. An
	 * element that can't be measured isn't watched.
	 */
	start(onPlace: (place: ActionBox) => void | Promise<void>): void {
		if (this.started || this.over) {
			return;
		}
		this.started = true;
		this.measure(this.steadyUntil, (box) => {
			if (!box) {
				this.end();
				return;
			}
			this.place = box;
			return onPlace(box);
		});
	}

	/**
	 * Hears where the element was before the action could have moved it:
	 * before Playwright scrolled to it. Undefined when that isn't known.
	 */
	wasAt(before: ActionBox | undefined, at: number, movedBy: number): void {
		if (!before || !this.place) {
			return;
		}
		if (samePlace(before, this.place)) {
			this.steadySince = at;
		} else {
			this.steadyFrom = movedBy;
		}
	}

	/**
	 * Sees whether the element is still in its place. Asked for as often as
	 * the page takes frames, so unless it's `due` it only measures every so
	 * often.
	 */
	check(due = false, at = this.now()): void {
		if (!this.watching) {
			return;
		}
		if (!due) {
			if (this.checks >= ACTION_MAX_CHECKS) {
				return;
			}
			const wait = this.lastCheckAt + ACTION_MIN_CHECK_GAP_MS - at;
			if (wait > 0) {
				// The frame still has to be vouched for: a measurement a little
				// after it says as much as one right away.
				this.later ??= setTimeout(() => {
					this.later = undefined;
					this.check();
				}, wait);
				this.later.unref();
				return;
			}
		}
		clearTimeout(this.later);
		this.later = undefined;
		this.checks += 1;
		this.measure(at, (box) => {
			if (box && this.place && samePlace(box, this.place)) {
				this.steadyUntil = at;
			} else {
				this.end();
			}
		});
	}

	/**
	 * Takes the element's place afresh: where it is now is where it's drawn
	 * from now on. `onMoved` hears the new place when it isn't the old one.
	 */
	settle(at: number, onMoved: (place: ActionBox) => void): void {
		if (!this.watching) {
			return;
		}
		this.measure(at, (box) => {
			if (!box) {
				this.end();
				return;
			}
			if (this.place && samePlace(box, this.place)) {
				// It was there all along: since it was first measured.
				this.steadySince = this.since;
			} else {
				this.place = box;
				this.steadyFrom = at;
				onMoved(box);
			}
			this.steadyUntil = at;
		});
	}

	/** Stops watching once the measurements asked for so far are in. */
	finish(): void {
		clearTimeout(this.timer);
		if (this.later) {
			clearTimeout(this.later);
			this.later = undefined;
			this.check(true);
		}
		this.handled = this.handled.then(() => this.end());
	}

	end(): void {
		if (this.over) {
			return;
		}
		this.over = true;
		clearTimeout(this.timer);
		clearTimeout(this.later);
		this.element.release();
	}

	settled(): Promise<void> {
		return this.handled;
	}

	private measure(
		at: number,
		handle: (box: ActionBox | undefined) => void | Promise<void>,
	): void {
		// Asked for right away, so the browser measures before it gets whatever
		// Playwright sends next.
		this.lastCheckAt = at;
		const measured = this.element.measure().then(
			(box) => box ?? undefined,
			() => undefined,
		);
		this.handled = this.handled.then(async () => {
			const box = await measured;
			if (!this.over) {
				await handle(box);
			}
		});
	}
}

/**
 * Assembles a test's actions from the moments Playwright was about to send
 * input. Nothing here waits: Playwright's calls carry on while elements are
 * measured.
 */
export class ActionRecorder {
	private readonly open = new Map<string, Call>();
	private readonly ended: Call[] = [];
	/** Calls whose element is being watched */
	private readonly watched = new Set<Call>();
	/** Where calls that have yet to send input found their element at first */
	private readonly befores = new Map<string, Before>();
	private readonly pageChanges = new Map<string, number>();
	private stopped = false;

	constructor(private readonly now: () => number = () => Date.now()) {}

	/**
	 * A call that may send pointer input has begun. `before` is where its
	 * element is now, ahead of Playwright scrolling to it; undefined when it
	 * can't be found yet.
	 */
	callStarted(callId: string, before: Promise<ActionBox | undefined>): void {
		if (!this.stopped) {
			this.befores.set(callId, { at: this.now(), place: before });
		}
	}

	/**
	 * A page changed as a whole: it went to another document, or was given a
	 * new size. Frames from before don't show what comes after.
	 */
	pageChanged(pageId: string): void {
		this.pageChanges.set(pageId, this.now());
	}

	/** Playwright is about to send input for a call; again on each retry. */
	input(event: ActionInputEvent): void {
		if (this.stopped) {
			event.element?.release();
			return;
		}

		let call = this.open.get(event.callId);
		if (!call) {
			call = {
				id: event.callId,
				pageId: event.pageId,
				method: event.method,
				inputs: [],
				failed: false,
				promptFrames: event.promptFrames === true,
				// Only the first attempt comes straight after the call began.
				before: this.befores.get(event.callId),
			};
			this.open.set(event.callId, call);
			this.befores.delete(event.callId);
		}
		// An earlier attempt, or the source of a drag: the highlight ends up on
		// the element of the last input.
		call.watch?.end();
		call.watch = undefined;
		this.watched.delete(call);

		const time = this.now();
		const input: RecordedInput = {
			time,
			...(event.point ? { point: roundPoint(event.point) } : {}),
			...(event.box ? { box: roundBox(event.box) } : {}),
			...(event.boxInChildFrame ? { boxInChildFrame: true } : {}),
		};
		call.inputs.push(input);
		call.pageChangedAt = this.pageChanges.get(call.pageId);
		const before = call.before;
		call.before = undefined;
		if (!event.element) {
			return;
		}

		const watch = new ElementWatch(event.element, this.now, time);
		call.watch = watch;
		this.watched.add(call);
		watch.start(async (place) => {
			if (input.point) {
				// Playwright scrolls to an element just before sending it pointer
				// input: where it was when the call began tells whether it did.
				watch.wasAt(await before?.place, before?.at ?? time, time);
				return;
			}
			// An element found by its selector comes measured in its own frame,
			// so this is the box to draw. Whether it moves shows when the call
			// ends: this input comes before Playwright focuses the element.
			input.box = roundBox(place);
			delete input.boxInChildFrame;
		});
	}

	/**
	 * A frame of a page was captured: see that the elements being watched on
	 * that page are still in place, so the frame can be vouched for. That goes
	 * for every recent action on the page, not only the last: the frame
	 * showing what one did often arrives after the next has begun.
	 */
	frameTaken(pageId: string): void {
		for (const call of this.watched) {
			if (call.pageId !== pageId || !call.watch) {
				continue;
			}
			// Input without a point comes before Playwright focuses the element,
			// which can scroll: where it is only counts once the call has ended.
			if (call.end === undefined && !call.inputs.at(-1)?.point) {
				continue;
			}
			call.watch.check();
		}
	}

	callEnded(callId: string, failed: boolean): void {
		const call = this.open.get(callId);
		if (!call || this.stopped) {
			this.befores.delete(callId);
			return;
		}
		this.open.delete(callId);
		this.befores.delete(callId);
		const end = this.now();
		call.end = end;
		call.failed = failed;
		this.ended.push(call);

		const watch = call.watch;
		const last = call.inputs.at(-1);
		if (!watch?.watching || !last) {
			return;
		}
		if (last.point) {
			watch.check(true, end);
		} else {
			watch.settle(end, (place) => {
				last.box = roundBox(place);
			});
		}
		watch.timer = setTimeout(() => {
			watch.finish();
			this.watched.delete(call);
		}, ACTION_WATCH_MS);
		// A watch must never keep a worker alive.
		watch.timer.unref();
	}

	/**
	 * Stops recording and returns the actions of the calls that ended, ordered
	 * by their first input.
	 */
	async finish(): Promise<RecordedAction[]> {
		this.stopped = true;
		const watches = [...this.open.values(), ...this.ended].flatMap(
			(call) => call.watch ?? [],
		);
		for (const watch of watches) {
			watch.finish();
		}
		let timeout: NodeJS.Timeout | undefined;
		await Promise.race([
			Promise.all(watches.map((watch) => watch.settled())),
			new Promise((resolve) => {
				timeout = setTimeout(resolve, SETTLE_TIMEOUT_MS);
			}),
		]);
		clearTimeout(timeout);
		for (const watch of watches) {
			watch.end();
		}
		this.watched.clear();
		this.open.clear();
		this.befores.clear();

		return this.ended
			.flatMap((call) => toAction(call) ?? [])
			.sort((a, b) => a.inputs[0].time - b.inputs[0].time);
	}
}

function toAction(call: Call): RecordedAction | undefined {
	if (call.end === undefined) {
		return undefined;
	}
	const inputs = call.inputs.flatMap((input): ActionInput[] => {
		const box = input.boxInChildFrame ? undefined : input.box;
		if (!input.point && !box) {
			return [];
		}
		return [
			{
				time: input.time,
				...(input.point ? { point: input.point } : {}),
				...(box ? { box } : {}),
			},
		];
	});
	const last = call.inputs.at(-1);
	if (inputs.length === 0 || !last) {
		return undefined;
	}
	// What was measured is the last input's element; without that input there
	// is nothing it applies to.
	const watch = inputs.at(-1)?.time === last.time ? call.watch : undefined;
	// A frame from before the page navigated shows another document.
	const steadyFrom = Math.max(
		watch?.steadyFrom ?? Number.NEGATIVE_INFINITY,
		call.pageChangedAt ?? Number.NEGATIVE_INFINITY,
	);
	return {
		pageId: call.pageId,
		end: call.end,
		...(call.failed ? { failed: true } : {}),
		method: call.method,
		inputs,
		// Without prompt frames, one from just after the element was measured
		// may show the page from before: nothing is said about those.
		...(watch?.steadySince !== undefined && call.promptFrames
			? { steadySince: watch.steadySince }
			: {}),
		...(Number.isFinite(steadyFrom) ? { steadyFrom } : {}),
		...(watch ? { steadyUntil: watch.steadyUntil } : {}),
	};
}

function samePlace(a: ActionBox, b: ActionBox): boolean {
	return (
		Math.abs(a.x - b.x) <= SAME_PLACE_TOLERANCE_PX &&
		Math.abs(a.y - b.y) <= SAME_PLACE_TOLERANCE_PX &&
		Math.abs(a.width - b.width) <= SAME_PLACE_TOLERANCE_PX &&
		Math.abs(a.height - b.height) <= SAME_PLACE_TOLERANCE_PX
	);
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

/** A call as Playwright's server instrumentation reports it. */
export interface ServerCall {
	id: string;
	method: string;
	/** Not one the test made, such as this fixture's own screencast calls */
	internal: boolean;
	failed: boolean;
	/** What the call was made with. Never recorded: it holds what is typed. */
	params: Record<string, unknown>;
	sdkObject: ServerObject;
}

interface ServerObject {
	attribution: {
		page?: { guid?: unknown; mainFrame?: unknown };
		frame?: unknown;
	};
	evaluateHandle?: unknown;
	boundingBox?: unknown;
	selectors?: { query?: unknown };
}

/**
 * Reads the arguments Playwright's server instrumentation gives its
 * listeners: `(progress, sdkObject, ...)` since Playwright 1.63. Undefined
 * for any other shape, such as the `(sdkObject, metadata, ...)` of older
 * versions, which this doesn't support.
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
		params: isRecord(metadata.params) ? metadata.params : {},
		sdkObject: sdkObject as unknown as ServerObject,
	};
}

type ServerListener = Record<
	"onBeforeCall" | "onBeforeInputAction" | "onAfterCall",
	(...args: unknown[]) => Promise<void>
>;

interface ServerInstrumentation {
	addListener(listener: ServerListener, context: unknown): void;
	removeListener(listener: ServerListener): void;
}

/**
 * The calls that scroll to their element and then send it pointer input.
 * Their element is measured as the call begins, to tell whether it scrolled.
 */
const POINTER_METHODS = new Set([
	"click",
	"dblclick",
	"hover",
	"tap",
	"check",
	"uncheck",
	"dragAndDrop",
]);

/**
 * The calls that change a page as a whole without navigating it, so that
 * frames from before them don't show what comes after.
 */
const PAGE_CHANGING_METHODS = new Set(["setViewportSize", "setContent"]);

/** Playwright awaits its listeners in turn, so none of them may take time. */
const DONE = Promise.resolve();

/**
 * Stands in for the progress of a Playwright server call, which the server's
 * `boundingBox` wants: these measurements belong to no call.
 */
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
 * Records where a test's actions land on its pages: the point clicked, the
 * element filled. Playwright's server works that out for every action and
 * tells the listeners of its instrumentation just before it sends the input.
 * In `@playwright/test` the server runs in the test's own process, so the
 * fixture can listen in. With a remote browser there is no server to listen
 * to and nothing is recorded.
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
	 * @param pageIdFor The `browser.page.id` of the page with a Playwright
	 * guid, or undefined for a page that isn't being captured.
	 */
	constructor(
		private readonly pageIdFor: (pageGuid: string) => string | undefined,
	) {}

	/** A frame of a page was captured for the trace. */
	frameTaken(pageId: string): void {
		this.recorder.frameTaken(pageId);
	}

	/** A page went to another document, or changed its URL. */
	pageNavigated(pageId: string): void {
		this.recorder.pageChanged(pageId);
	}

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
			const listener = this.createListener(hasPromptFrames(context));
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
	 * Stops recording. Undefined when nothing could be recorded, as opposed to
	 * a test that did nothing to its pages.
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

	private createListener(promptFrames: boolean): ServerListener {
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
			onBeforeCall: listen((call) => {
				if (
					!call.internal &&
					POINTER_METHODS.has(call.method) &&
					this.pageIdOf(call)
				) {
					this.recorder.callStarted(call.id, measureBefore(call));
				}
			}),
			onBeforeInputAction: listen((call, args) => {
				this.recordInput(call, args[2], args[3], promptFrames);
			}),
			onAfterCall: listen((call) => {
				this.recorder.callEnded(call.id, call.failed);
				if (PAGE_CHANGING_METHODS.has(call.method)) {
					const pageId = this.pageIdOf(call);
					if (pageId) {
						this.recorder.pageChanged(pageId);
					}
				}
			}),
		};
	}

	private recordInput(
		call: ServerCall,
		pointArg: unknown,
		boxArg: unknown,
		promptFrames: boolean,
	) {
		const pageId = this.pageIdOf(call);
		const point = parsePoint(pointArg);
		const box = parseBox(boxArg);
		// Keyboard input has nowhere to draw.
		if (!pageId || call.internal || (!point && !box)) {
			return;
		}
		this.recorder.input({
			callId: call.id,
			pageId,
			method: call.method,
			point,
			box,
			// Pointer input is measured in the main viewport; an element found by
			// its selector is measured in its own frame.
			boxInChildFrame: !point && !isInMainFrame(call.sdkObject),
			element: elementOf(call.sdkObject),
			promptFrames,
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

/**
 * Whether a context's frames are stamped with the time they were shown.
 * Chromium's are. Playwright dates Firefox's and WebKit's from when the first
 * one reached it, so theirs run late by however long that took.
 */
function hasPromptFrames(context: BrowserContext): boolean {
	try {
		return context.browser()?.browserType().name() === "chromium";
	} catch {
		return false;
	}
}

function isInMainFrame(sdkObject: ServerObject): boolean {
	const { page, frame } = sdkObject.attribution;
	if (!frame || typeof page?.mainFrame !== "function") {
		return false;
	}
	return page.mainFrame() === frame;
}

/**
 * Where the element a call is about to act on is right now, in the page's
 * main viewport: for a call on a handle, the handle; for a call with a
 * selector, the element it finds at this moment. Undefined when there is no
 * such element yet, as the call may be waiting for it to appear.
 */
async function measureBefore(call: ServerCall): Promise<ActionBox | undefined> {
	type Handle = {
		boundingBox(progress: unknown): Promise<unknown>;
		dispose?(): void;
	};
	try {
		const { sdkObject, params } = call;
		if (typeof sdkObject.boundingBox === "function") {
			return parseBox(await (sdkObject as Handle).boundingBox(NO_PROGRESS));
		}
		// A drag ends on its target, which is the element that's drawn.
		const selector =
			call.method === "dragAndDrop" ? params.target : params.selector;
		const query = sdkObject.selectors?.query;
		if (typeof selector !== "string" || typeof query !== "function") {
			return undefined;
		}
		const strict = params.strict === true;
		// Playwright 1.65 folded the arguments into one.
		const handle = (await (query.length > 1
			? query.call(sdkObject.selectors, selector, { strict })
			: query.call(sdkObject.selectors, {
					selector,
					strict,
				}))) as Handle | null;
		if (!handle) {
			return undefined;
		}
		try {
			return parseBox(await handle.boundingBox(NO_PROGRESS));
		} finally {
			handle.dispose?.();
		}
	} catch {
		return undefined;
	}
}

/**
 * Runs in the page. Playwright lets go of its own handle to the element as
 * soon as its call ends, so this takes another one.
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
	const measureWith = async (handle: Handle) =>
		parseBox(await handle.boundingBox(NO_PROGRESS)) ?? null;
	let kept: Promise<Handle>;
	try {
		kept = Promise.resolve(evaluateHandle.call(sdkObject, keepElement));
	} catch {
		return undefined;
	}
	// The page can go away at any moment.
	kept.catch(() => {});
	let measured = false;
	return {
		measure: async () => {
			if (!measured) {
				// Playwright's own handle is still good at this point, and using
				// it gets the measurement to the browser ahead of anything the
				// call does next, such as scrolling to the element.
				measured = true;
				return measureWith(sdkObject as unknown as Handle);
			}
			return measureWith(await kept);
		},
		release: () => {
			void kept.then(
				(handle) => handle.dispose?.(),
				() => {},
			);
		},
	};
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

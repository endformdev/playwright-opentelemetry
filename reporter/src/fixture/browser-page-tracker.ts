import type { ConsoleMessage, Page, Request } from "@playwright/test";
import { generateSpanId } from "../shared/otel";
import {
	BROWSER_SERVICE_NAME,
	type FixtureSpan,
	type TestTraceContext,
} from "./trace-context";

const BROWSER_PAGE_SPAN_NAME = "browser.page";
const BROWSER_ROUTE_SPAN_NAME = "browser.route";
const SPAN_STATUS_CODE_UNSET = 0;

type NavigationType = "document" | "same-document";

interface PageState {
	pageId: string;
	lastUrl: string;
	documentUrl?: string;
	activeDocumentSpan?: ActiveBrowserSpan;
	activeRouteSpan?: ActiveBrowserSpan;
}

interface ActiveBrowserSpan {
	span: FixtureSpan;
	url: string;
}

export class BrowserPageTracker {
	private nextPageId = 1;
	private pageStates = new WeakMap<Page, PageState>();
	private pages = new Set<Page>();

	constructor(private readonly traceContext: TestTraceContext) {}

	registerPage(page: Page): void {
		this.stateFor(page);
		this.pages.add(page);
	}

	unregisterPage(page: Page, endTime = new Date()): void {
		this.finishPageSpans(page, endTime);
		this.pages.delete(page);
	}

	finishAll(endTime = new Date()): void {
		for (const page of this.pages) {
			this.finishPageSpans(page, endTime);
		}
		this.pages.clear();
	}

	startDocumentNavigation(request: Request): void {
		if (!isMainFrameNavigationRequest(request)) {
			return;
		}

		const page = pageForRequest(request);
		if (!page) {
			return;
		}

		this.startDocumentPageSpan(page, request.url(), new Date());
	}

	handleFrameNavigated(page: Page, url: string): void {
		const state = this.stateFor(page);
		const previousUrl = state.lastUrl;
		state.lastUrl = url;

		if (!previousUrl || previousUrl === "about:blank") {
			return;
		}

		if (
			!shouldCreateSameDocumentPageSpan(
				previousUrl,
				url,
				state.activeRouteSpan?.url,
			)
		) {
			return;
		}

		this.startRouteSpan(page, url, previousUrl, new Date());
	}

	getNetworkParent(request: Request): {
		spanId: string;
		routeAssociation: "active-route" | "active-page" | "root";
	} {
		const page = pageForRequest(request);
		if (!page) {
			return {
				spanId: this.traceContext.rootSpanId,
				routeAssociation: "root",
			};
		}

		const state = this.stateFor(page);
		if (state.activeRouteSpan) {
			return {
				spanId: state.activeRouteSpan.span.spanId,
				routeAssociation: "active-route",
			};
		}

		if (state.activeDocumentSpan) {
			return {
				spanId: state.activeDocumentSpan.span.spanId,
				routeAssociation: "active-page",
			};
		}

		return {
			spanId: this.traceContext.rootSpanId,
			routeAssociation: "root",
		};
	}

	recordConsoleMessage(
		page: Page,
		message: ConsoleMessage,
		time = new Date(),
	): void {
		const activeSpan = this.getActiveBrowserSpan(page);
		if (!activeSpan) {
			return;
		}

		const type = message.type();
		const attributes: Record<string, string | number | boolean | string[]> = {
			message: message.text(),
			"browser.console.type": type,
			"severity.text": consoleSeverityText(type),
		};

		const location = message.location();
		if (location.url) {
			attributes["code.file.path"] = location.url;
		}
		const line = consoleLocationLine(location);
		if (line !== undefined) {
			attributes["code.line.number"] = line + 1;
		}

		activeSpan.events.push({
			name: "log",
			time,
			attributes,
		});
	}

	recordPageError(page: Page, error: Error, time = new Date()): void {
		const activeSpan = this.getActiveBrowserSpan(page);
		if (!activeSpan) {
			return;
		}

		const attributes: Record<string, string | number | boolean | string[]> = {};
		if (error.name) {
			attributes["exception.type"] = error.name;
		}
		if (error.message) {
			attributes["exception.message"] = error.message;
		}
		if (error.stack) {
			attributes["exception.stacktrace"] = error.stack;
		}

		activeSpan.events.push({
			name: "exception",
			time,
			attributes,
		});
	}

	private startDocumentPageSpan(
		page: Page,
		url: string,
		startTime: Date,
	): void {
		const state = this.stateFor(page);
		this.finishPageSpans(page, startTime);

		const span = this.createBrowserSpan({
			pageId: state.pageId,
			name: BROWSER_PAGE_SPAN_NAME,
			url,
			navigationType: "document",
			parentSpanId: this.traceContext.rootSpanId,
			startTime,
		});

		state.activeDocumentSpan = { span, url };
		state.documentUrl = url;
		state.lastUrl = url;
		this.traceContext.addSpan(span);
	}

	private startRouteSpan(
		page: Page,
		url: string,
		previousUrl: string,
		startTime: Date,
	): void {
		const state = this.stateFor(page);
		this.finishRouteSpan(state, startTime);

		const span = this.createBrowserSpan({
			pageId: state.pageId,
			name: BROWSER_ROUTE_SPAN_NAME,
			url,
			navigationType: "same-document",
			parentSpanId:
				state.activeDocumentSpan?.span.spanId ?? this.traceContext.rootSpanId,
			startTime,
			previousUrl,
			documentUrl: state.documentUrl,
		});

		state.activeRouteSpan = { span, url };
		this.traceContext.addSpan(span);
	}

	private finishPageSpans(page: Page, endTime: Date): void {
		const state = this.pageStates.get(page);
		if (!state) {
			return;
		}

		this.finishRouteSpan(state, endTime);
		if (state.activeDocumentSpan) {
			state.activeDocumentSpan.span.endTime = endTime;
			state.activeDocumentSpan = undefined;
		}
	}

	private finishRouteSpan(state: PageState, endTime: Date): void {
		if (state.activeRouteSpan) {
			state.activeRouteSpan.span.endTime = endTime;
			state.activeRouteSpan = undefined;
		}
	}

	private getActiveBrowserSpan(page: Page): FixtureSpan | undefined {
		const state = this.pageStates.get(page);
		return state?.activeRouteSpan?.span ?? state?.activeDocumentSpan?.span;
	}

	private stateFor(page: Page): PageState {
		const existing = this.pageStates.get(page);
		if (existing) {
			return existing;
		}

		const state = {
			pageId: `page-${this.nextPageId++}`,
			lastUrl: page.url(),
		};
		this.pageStates.set(page, state);
		return state;
	}

	private createBrowserSpan({
		pageId,
		name,
		url,
		navigationType,
		parentSpanId,
		startTime,
		previousUrl,
		documentUrl,
	}: {
		pageId: string;
		name: string;
		url: string;
		navigationType: NavigationType;
		parentSpanId: string;
		startTime: Date;
		previousUrl?: string;
		documentUrl?: string;
	}): FixtureSpan {
		return {
			traceId: this.traceContext.traceId,
			spanId: generateSpanId(),
			parentSpanId,
			name,
			startTime,
			endTime: startTime,
			status: { code: SPAN_STATUS_CODE_UNSET },
			attributes: pageAttributes({
				pageId,
				url,
				navigationType,
				previousUrl,
				documentUrl,
			}),
			events: [],
			serviceName: BROWSER_SERVICE_NAME,
		};
	}
}

function consoleSeverityText(type: string): string {
	switch (type) {
		case "debug":
			return "DEBUG";
		case "warning":
			return "WARN";
		case "error":
		case "assert":
			return "ERROR";
		case "trace":
			return "TRACE";
		default:
			return "INFO";
	}
}

type ConsoleLocation = ReturnType<ConsoleMessage["location"]> & {
	line?: number;
	column?: number;
};

function consoleLocationLine(location: ConsoleLocation): number | undefined {
	return location.line ?? location.lineNumber;
}

function pageAttributes({
	pageId,
	url,
	navigationType,
	previousUrl,
	documentUrl,
}: {
	pageId: string;
	url: string;
	navigationType: NavigationType;
	previousUrl?: string;
	documentUrl?: string;
}): Record<string, string | number | boolean> {
	const attributes: Record<string, string | number | boolean> = {
		"browser.resource.type": navigationType === "document" ? "page" : "route",
		"browser.page.id": pageId,
		"browser.page.navigation.type": navigationType,
		"url.full": url,
	};

	try {
		const parsedUrl = new URL(url);
		attributes["url.path"] = parsedUrl.pathname;
		if (parsedUrl.search) {
			attributes["url.query"] = parsedUrl.search.slice(1);
		}
	} catch {
		// Leave only url.full for non-standard browser URLs.
	}

	if (previousUrl) {
		attributes["browser.route.previous_url"] = previousUrl;
	}

	if (documentUrl) {
		attributes["browser.document.url"] = documentUrl;
	}

	return attributes;
}

function isMainFrameNavigationRequest(request: Request): boolean {
	if (!request.isNavigationRequest()) {
		return false;
	}

	try {
		const frame = request.frame();
		return frame === frame.page().mainFrame();
	} catch {
		return false;
	}
}

function pageForRequest(request: Request): Page | undefined {
	try {
		return request.frame().page();
	} catch {
		return undefined;
	}
}

function stripHash(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return url.split("#")[0] ?? url;
	}
}

export function shouldCreateSameDocumentPageSpan(
	previousUrl: string,
	nextUrl: string,
	activePageUrl?: string,
): boolean {
	if (activePageUrl && stripHash(activePageUrl) === stripHash(nextUrl)) {
		return false;
	}

	return stripHash(previousUrl) !== stripHash(nextUrl);
}

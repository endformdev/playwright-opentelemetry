import type { Page, Request } from "@playwright/test";
import {
	type BrowserPageSpan,
	generateSpanId,
	getCurrentSpanId,
	getOrCreateTraceId,
	writeBrowserPageSpan,
} from "../shared/trace-files";

const BROWSER_PAGE_SPAN_NAME = "browser.page";
const BROWSER_SERVICE_NAME = "playwright-browser";
const SPAN_STATUS_CODE_UNSET = 0;

type NavigationType = "document" | "same-document";

interface ActiveBrowserPageSpan {
	pageId: string;
	spanId: string;
	url: string;
}

export class BrowserPageTracker {
	private nextPageId = 1;
	private pageIds = new WeakMap<Page, string>();
	private activePageSpans = new WeakMap<Page, ActiveBrowserPageSpan>();
	private lastFrameUrls = new WeakMap<Page, string>();

	constructor(
		private readonly testId: string,
		private readonly outputDir: string,
	) {}

	registerPage(page: Page): void {
		this.pageIdFor(page);
		this.lastFrameUrls.set(page, page.url());
	}

	startDocumentNavigation(request: Request): void {
		if (!isMainFrameNavigationRequest(request)) {
			return;
		}

		const page = pageForRequest(request);
		if (!page) {
			return;
		}

		this.startPageSpan(page, request.url(), "document");
	}

	handleFrameNavigated(page: Page, url: string): void {
		const previousUrl = this.lastFrameUrls.get(page);
		this.lastFrameUrls.set(page, url);

		if (!previousUrl || previousUrl === "about:blank") {
			return;
		}

		const activeSpan = this.activePageSpans.get(page);
		if (!shouldCreateSameDocumentPageSpan(previousUrl, url, activeSpan?.url)) {
			return;
		}

		this.startPageSpan(page, url, "same-document", previousUrl);
	}

	getActivePageSpanId(request: Request): string | undefined {
		const page = pageForRequest(request);
		if (!page) {
			return undefined;
		}

		return this.activePageSpans.get(page)?.spanId;
	}

	private startPageSpan(
		page: Page,
		url: string,
		navigationType: NavigationType,
		previousUrl?: string,
	): void {
		const pageId = this.pageIdFor(page);
		const traceId = getOrCreateTraceId(this.outputDir, this.testId);
		const spanId = generateSpanId();
		const parentSpanId = getCurrentSpanId(this.outputDir, this.testId);
		const startTime = new Date();
		const attributes = pageAttributes(pageId, url, navigationType, previousUrl);

		const span: BrowserPageSpan = {
			traceId,
			spanId,
			parentSpanId,
			name: BROWSER_PAGE_SPAN_NAME,
			startTime,
			endTime: startTime,
			status: { code: SPAN_STATUS_CODE_UNSET },
			attributes,
			serviceName: BROWSER_SERVICE_NAME,
		};

		this.activePageSpans.set(page, { pageId, spanId, url });
		this.lastFrameUrls.set(page, url);
		writeBrowserPageSpan(this.outputDir, this.testId, span);
	}

	private pageIdFor(page: Page): string {
		const existing = this.pageIds.get(page);
		if (existing) {
			return existing;
		}

		const pageId = `page-${this.nextPageId++}`;
		this.pageIds.set(page, pageId);
		return pageId;
	}
}

function pageAttributes(
	pageId: string,
	url: string,
	navigationType: NavigationType,
	previousUrl?: string,
): Record<string, string | number | boolean> {
	const attributes: Record<string, string | number | boolean> = {
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
		attributes["browser.page.previous_url"] = previousUrl;
	}

	return attributes;
}

function isMainFrameNavigationRequest(request: Request): boolean {
	if (!request.isNavigationRequest()) {
		return false;
	}

	const frame = request.frame();
	return frame === frame.page().mainFrame();
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

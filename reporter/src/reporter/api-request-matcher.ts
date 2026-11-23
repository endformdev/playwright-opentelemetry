import type { TestStep } from "@playwright/test/reporter";
import type { CapturedApiRequest } from "../shared/api-requests";

/**
 * Playwright's step starts before the request is sent and ends after the
 * response is read. Both clocks are the worker's, but they round to the
 * millisecond on their own.
 */
const STEP_WINDOW_TOLERANCE_MS = 5;

const API_REQUEST_TITLE_PATTERN =
	/^(DELETE|FETCH|GET|HEAD|PATCH|POST|PUT)\s+"(.*)"$/;

/** What a step tells about the request it made. */
export type ApiRequestStepCall = {
	/** Undefined for `fetch` without a method, which could be any. */
	method?: string;
	url?: string;
};

/**
 * `APIRequestContext` calls. From Playwright 1.63 they report a url and a
 * method; before that they show up only in the title, e.g. `GET "/api"`.
 */
export function apiRequestStepCall(
	step: TestStep,
): ApiRequestStepCall | undefined {
	if (step.category !== "pw:api") {
		return undefined;
	}
	if (step.params) {
		const { url, method } = step.params;
		return typeof url === "string" && typeof method === "string"
			? { method: method.toUpperCase(), url }
			: undefined;
	}
	const match = API_REQUEST_TITLE_PATTERN.exec(step.title);
	if (!match) {
		return undefined;
	}
	return {
		method: match[1] === "FETCH" ? undefined : match[1],
		url: match[2],
	};
}

type PendingRequest = CapturedApiRequest & { start: number; used: boolean };

/**
 * Pairs the requests the fixture recorded with the steps that made them. Each
 * request is used at most once.
 */
export class ApiRequestMatcher {
	private readonly requests: PendingRequest[];

	constructor(requests: CapturedApiRequest[]) {
		this.requests = requests
			.map((request) => ({
				...request,
				start: Date.parse(request.startTime),
				used: false,
			}))
			.filter((request) => !Number.isNaN(request.start))
			.sort((a, b) => a.start - b.start);
	}

	/**
	 * The request the step made, followed by the redirects Playwright followed
	 * for it. Undefined when the fixture recorded no such request, for example
	 * one made through a context it doesn't record.
	 */
	take(
		step: TestStep,
		call: ApiRequestStepCall,
	): CapturedApiRequest[] | undefined {
		const from = step.startTime.getTime() - STEP_WINDOW_TOLERANCE_MS;
		const to =
			step.startTime.getTime() + step.duration + STEP_WINDOW_TOLERANCE_MS;
		const inWindow = (request: PendingRequest) =>
			!request.used && request.start >= from && request.start <= to;

		const first = this.requests.find(
			(request) =>
				inWindow(request) &&
				(call.method === undefined || request.method === call.method) &&
				(call.url === undefined || isSameResource(call.url, request.url)),
		);
		if (!first) {
			return undefined;
		}

		first.used = true;
		const chain: PendingRequest[] = [first];
		for (
			let current = first;
			current.redirectUrl !== undefined && isRedirect(current.status);
		) {
			const location = resolveUrl(current.redirectUrl, current.url);
			const next = this.requests.find(
				(request) =>
					inWindow(request) &&
					request.start >= current.start &&
					request.url === location,
			);
			if (!next) {
				break;
			}
			next.used = true;
			chain.push(next);
			current = next;
		}
		return chain.map(({ start: _start, used: _used, ...request }) => request);
	}

	/** Requests no step claimed. */
	unmatched(): CapturedApiRequest[] {
		return this.requests
			.filter((request) => !request.used)
			.map(({ start: _start, used: _used, ...request }) => request);
	}
}

/**
 * Whether the URL a step was called with names the URL that was requested.
 * Playwright resolves relative URLs against `baseURL` and appends `params`,
 * so only the origin (when the step has one) and the path are compared.
 */
function isSameResource(stepUrl: string, requestedUrl: string): boolean {
	let requested: URL;
	try {
		requested = new URL(requestedUrl);
	} catch {
		return stepUrl === requestedUrl;
	}

	const stepPath = stepUrl.split(/[?#]/, 1)[0] ?? "";
	try {
		const absolute = new URL(stepPath);
		return (
			absolute.origin === requested.origin &&
			absolute.pathname === requested.pathname
		);
	} catch {
		// A relative URL.
	}
	// Relative to `baseURL`, whose path is unknown here, so compare the end.
	// The placeholder origin only normalizes the path's encoding.
	const relativePath = new URL(
		stepPath.replace(/^\.?\//, ""),
		"http://placeholder/",
	).pathname;
	return requested.pathname.endsWith(relativePath);
}

function isRedirect(status: number): boolean {
	return status >= 300 && status < 400;
}

function resolveUrl(location: string, base: string): string {
	try {
		return new URL(location, base).href;
	} catch {
		return location;
	}
}

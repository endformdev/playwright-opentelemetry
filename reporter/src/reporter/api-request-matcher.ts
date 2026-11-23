import path from "node:path";
import type { TestStep } from "@playwright/test/reporter";
import {
	API_REQUEST_WRAPPER_FILE,
	type CapturedApiRequest,
} from "../shared/api-requests";

/** What a step itself says about the `APIRequestContext` call it reports. */
export interface ApiRequestStepCall {
	/** Upper case. */
	method?: string;
	/**
	 * As the test passed it. Playwright cuts long values short, ending them
	 * with `…`.
	 */
	url?: string;
}

const HTTP_METHODS = "DELETE|FETCH|GET|HEAD|PATCH|POST|PUT";
// Playwright 1.52 to 1.62: `GET "/api"`.
const QUOTED_URL_TITLE = new RegExp(`^(${HTTP_METHODS}|\\{method\\})\\s+"`);
// Playwright 1.51 and older: `apiRequestContext.get(/api)`.
const API_NAME_TITLE = new RegExp(
	`^apiRequestContext\\.(${HTTP_METHODS})\\(`,
	"i",
);
// A `fetch()` without a method: Playwright has nothing to fill its title with.
const NO_METHOD_TITLE = "{method}";

/**
 * Recognises the step of an `APIRequestContext` call. From Playwright 1.63
 * such a step reports the call's url and method as params; before that they
 * only show in its title.
 */
export function apiRequestStepCall(
	step: TestStep,
): ApiRequestStepCall | undefined {
	if (step.category !== "pw:api") {
		return undefined;
	}

	if (step.params) {
		const { url, method } = step.params as { url?: unknown; method?: unknown };
		if (typeof url !== "string") {
			return undefined;
		}
		if (typeof method === "string") {
			return { method: method.toUpperCase(), url };
		}
		// Other calls have a url too, such as `page.goto()`.
		return step.title === NO_METHOD_TITLE ? { url } : undefined;
	}

	const method = (QUOTED_URL_TITLE.exec(step.title) ??
		API_NAME_TITLE.exec(step.title))?.[1];
	if (!method) {
		return undefined;
	}
	const upperCased = method.toUpperCase();
	return upperCased === "FETCH" || upperCased === NO_METHOD_TITLE.toUpperCase()
		? {}
		: { method: upperCased };
}

/**
 * Pairs each request step with the call the fixture recorded for it. The
 * fixture records where the test made the call, which is exactly the step's
 * location, so the nth call from a place belongs to the nth step from that
 * place.
 */
export class ApiRequestMatcher {
	private readonly unclaimed: CapturedApiRequest[];
	/** Whether Playwright located a step in the fixture's wrapper. */
	wrapperWasVisible = false;

	constructor(
		requests: CapturedApiRequest[],
		private readonly rootDir: string | undefined,
	) {
		this.unclaimed = [...requests];
	}

	take(
		step: TestStep,
		call: ApiRequestStepCall,
	): CapturedApiRequest | undefined {
		// Playwright normally leaves the wrapper out of the stack. If a version
		// doesn't, its steps all point at the wrapper: pair them in call order.
		const locatedInWrapper = isApiRequestWrapperFile(step.location?.file);
		this.wrapperWasVisible ||= locatedInWrapper;

		const candidates = this.unclaimed.filter((request) =>
			locatedInWrapper || !request.location
				? agreesOnMethod(call, request)
				: this.isSameLocation(step, request.location),
		);
		const match =
			candidates.find(
				(request) =>
					agreesOnMethod(call, request) && agreesOnUrl(call, request),
			) ??
			candidates.find((request) => agreesOnMethod(call, request)) ??
			candidates[0];
		if (match) {
			this.unclaimed.splice(this.unclaimed.indexOf(match), 1);
		}
		return match;
	}

	/** Recorded calls no step reported. */
	unmatched(): CapturedApiRequest[] {
		return [...this.unclaimed];
	}

	private isSameLocation(
		step: TestStep,
		location: NonNullable<CapturedApiRequest["location"]>,
	): boolean {
		if (!step.location) {
			return false;
		}
		const stepFile = this.rootDir
			? path.relative(this.rootDir, step.location.file)
			: step.location.file;
		return (
			step.location.line === location.line &&
			step.location.column === location.column &&
			withForwardSlashes(stepFile) === withForwardSlashes(location.file)
		);
	}
}

export function isApiRequestWrapperFile(file: string | undefined): boolean {
	return file !== undefined && file.includes(API_REQUEST_WRAPPER_FILE);
}

function agreesOnMethod(
	call: ApiRequestStepCall,
	request: CapturedApiRequest,
): boolean {
	return call.method === undefined || call.method === request.method;
}

const CUT_SHORT = "…";

function agreesOnUrl(
	call: ApiRequestStepCall,
	request: CapturedApiRequest,
): boolean {
	if (call.url === undefined) {
		return true;
	}
	return call.url.endsWith(CUT_SHORT)
		? request.url.startsWith(call.url.slice(0, -CUT_SHORT.length))
		: call.url === request.url;
}

function withForwardSlashes(file: string): string {
	return file.replace(/\\/g, "/");
}

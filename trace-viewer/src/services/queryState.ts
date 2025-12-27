/**
 * Lightweight query parameter state management without a router.
 * Each parameter gets its own signal for fine-grained reactivity.
 */

import { createSignal } from "solid-js";

/**
 * Parse query parameters from the current URL
 */
function getQueryParams(): URLSearchParams {
	return new URLSearchParams(window.location.search);
}

/**
 * Update the URL with new query parameters
 */
function updateUrl(params: URLSearchParams, push: boolean): void {
	const url = new URL(window.location.href);
	url.search = params.toString();

	if (push) {
		window.history.pushState(null, "", url.toString());
	} else {
		window.history.replaceState(null, "", url.toString());
	}
}

// Individual signals for each query parameter
const [traceSource, setTraceSourceInternal] = createSignal<string | null>(
	getQueryParams().get("traceSource"),
);

/**
 * Update the traceSource query parameter
 * @param value - The new value (null to remove)
 * @param push - Whether to push a new history entry (default: true)
 */
export function setTraceSource(value: string | null, push = true): void {
	setTraceSourceInternal(value);

	const params = getQueryParams();
	if (value) {
		params.set("traceSource", value);
	} else {
		params.delete("traceSource");
	}
	updateUrl(params, push);
}

// Handle browser back/forward navigation
if (typeof window !== "undefined") {
	window.addEventListener("popstate", () => {
		const params = getQueryParams();
		setTraceSourceInternal(params.get("traceSource"));
	});
}

export { traceSource };

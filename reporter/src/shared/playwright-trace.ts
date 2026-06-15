export type PlaywrightTraceMode =
	| "off"
	| "on"
	| "retain-on-failure"
	| "on-first-retry"
	| "on-all-retries"
	| "retain-on-first-failure"
	| "retain-on-failure-and-retries";

export type PlaywrightTraceOption =
	| PlaywrightTraceMode
	| "retry-with-trace"
	| {
			mode: PlaywrightTraceMode;
			snapshots?: boolean;
			screenshots?: boolean;
			sources?: boolean;
			attachments?: boolean;
	  };

export type PlaywrightTraceRetentionTestInfo = {
	expectedStatus?: string;
	retry?: number;
	status?: string;
};

export function shouldRetainPlaywrightTrace(
	trace: PlaywrightTraceOption | undefined,
	testInfo?: PlaywrightTraceRetentionTestInfo,
): boolean {
	const mode = normalizeTraceMode(trace);
	const retry = testInfo?.retry ?? 0;
	const testFailed =
		(testInfo?.status ?? "passed") !== (testInfo?.expectedStatus ?? "passed");

	switch (mode) {
		case "on":
			return true;
		case "on-first-retry":
			return retry === 1;
		case "on-all-retries":
			return retry > 0;
		case "retain-on-failure":
			return testFailed;
		case "retain-on-first-failure":
			return retry === 0 && testFailed;
		case "retain-on-failure-and-retries":
			return testFailed || retry > 0;
		case "off":
			return false;
	}
}

function normalizeTraceMode(
	trace: PlaywrightTraceOption | undefined,
): PlaywrightTraceMode {
	const mode = typeof trace === "string" ? trace : (trace?.mode ?? "off");
	return mode === "retry-with-trace" ? "on-first-retry" : mode;
}

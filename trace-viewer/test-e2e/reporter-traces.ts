import type { APIRequestContext } from "@playwright/test";
import { TRACE_API_URL } from "./page-objects/trace-viewer-page";
import type { ReporterTrace } from "./setup/global-setup";

/**
 * The ID of a trace the reporter run in global setup made. Fetched from the
 * trace API server rather than read from disk: global setup runs where the run
 * starts, and on Endform the specs run on other machines.
 */
export async function reporterTraceId(
	request: APIRequestContext,
	trace: ReporterTrace,
): Promise<string> {
	const response = await request.get(
		`${TRACE_API_URL}/fixtures/reporter-traces/${trace}/trace-id`,
	);
	if (!response.ok()) {
		throw new Error(
			`No ${trace} trace ID: ${response.status()} ${await response.text()}`,
		);
	}
	return (await response.text()).trim();
}

/** The trace ZIP the reporter stored for the `browser-page-spans` test, ready for `setInputFiles`. */
export async function reporterTraceZip(request: APIRequestContext): Promise<{
	name: string;
	mimeType: string;
	buffer: Buffer;
}> {
	const response = await request.get(
		`${TRACE_API_URL}/fixtures/browser-page-spans-trace.zip`,
	);
	if (!response.ok()) {
		throw new Error(
			`No reporter trace ZIP: ${response.status()} ${await response.text()}`,
		);
	}
	return {
		name: "browser-page-spans-trace.zip",
		mimeType: "application/zip",
		buffer: await response.body(),
	};
}

import type { OtlpTraceExport } from "../trace-info-loader/otel";
import { type CategorizedSpans, categorizeSpans } from "./categorizeSpans";
import { normalizeOtlpExport } from "./normalizeSpans";

export async function fetchTraceData(
	url: string,
	testStartTimeMs: number,
): Promise<CategorizedSpans> {
	const response = await fetch(url);

	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`Failed to fetch trace data from ${url}: ${response.status} ${body}`,
		);
	}

	const otlpExport: OtlpTraceExport = await response.json();
	const normalizedSpans = normalizeOtlpExport(otlpExport, testStartTimeMs);

	return categorizeSpans(normalizedSpans);
}

export interface OtlpExport {
	resourceSpans?: OtlpResourceSpans[];
}

export interface OtlpResourceSpans {
	resource?: unknown;
	scopeSpans?: OtlpScopeSpans[];
	[key: string]: unknown;
}

export interface OtlpScopeSpans {
	scope?: unknown;
	spans?: OtlpSpan[];
	[key: string]: unknown;
}

export interface OtlpSpan {
	traceId?: string;
	spanId?: string;
	[key: string]: unknown;
}

export function partitionOtlpExportByTraceId(
	payload: OtlpExport,
): Map<string, OtlpExport> {
	const traces = new Map<string, OtlpExport>();

	for (const resourceSpan of payload.resourceSpans ?? []) {
		for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
			const spansByTraceId = new Map<string, OtlpSpan[]>();

			for (const span of scopeSpan.spans ?? []) {
				if (!span.traceId) continue;
				const spans = spansByTraceId.get(span.traceId) ?? [];
				spans.push(span);
				spansByTraceId.set(span.traceId, spans);
			}

			for (const [traceId, spans] of spansByTraceId) {
				const traceExport = traces.get(traceId) ?? { resourceSpans: [] };
				traceExport.resourceSpans?.push({
					...resourceSpan,
					scopeSpans: [
						{
							...scopeSpan,
							spans,
						},
					],
				});
				traces.set(traceId, traceExport);
			}
		}
	}

	return traces;
}

export function mergeOtlpExports(payloads: OtlpExport[]): Required<OtlpExport> {
	return {
		resourceSpans: payloads.flatMap((payload) => payload.resourceSpans ?? []),
	};
}

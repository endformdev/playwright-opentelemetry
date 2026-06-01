export type { CategorizedSpans } from "./categorizeSpans";
export { categorizeSpan, categorizeSpans, mergeSpans } from "./categorizeSpans";

export type { Span, SpanKind } from "./exportToSpans";
export { otlpExportToSpans, otlpSpanToSpan } from "./exportToSpans";
export type { OtlpAttribute, OtlpExport, OtlpSpan } from "./fetchTraceData";
export {
	fetchTraceData,
	mergeOtlpExports,
	parseOtlpExport,
} from "./fetchTraceData";

export type { LoadStatus, TraceDataLoaderResult } from "./useTraceDataLoader";
export { useTraceDataLoader } from "./useTraceDataLoader";

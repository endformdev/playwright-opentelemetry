import type { SpanEvent } from "../../trace-data-loader/exportToSpans";

export type SpanEventSeverity = "default" | "warning" | "error";

export function getSpanEventSeverity(event: SpanEvent): SpanEventSeverity {
	if (event.name === "exception") {
		return "error";
	}

	const severityText = event.attributes["severity.text"];
	if (typeof severityText !== "string") {
		return "default";
	}

	switch (severityText.toUpperCase()) {
		case "ERROR":
		case "FATAL":
			return "error";
		case "WARN":
		case "WARNING":
			return "warning";
		default:
			return "default";
	}
}

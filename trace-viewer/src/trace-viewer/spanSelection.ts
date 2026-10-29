export type SpanSelectionPlacement = "start" | "center" | "end";

export function getSpanSelectionTimeMs(
	span: { startOffsetMs: number; durationMs: number },
	placement: SpanSelectionPlacement,
): number {
	switch (placement) {
		case "start":
			return span.startOffsetMs;
		case "center":
			return span.startOffsetMs + span.durationMs / 2;
		case "end":
			return span.startOffsetMs + span.durationMs;
	}
}

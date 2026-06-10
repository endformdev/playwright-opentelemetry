export type SpanSelectionPlacement = "start" | "end";

export function getSpanSelectionTimeMs(
	span: { startOffsetMs: number; durationMs: number },
	placement: SpanSelectionPlacement,
): number {
	switch (placement) {
		case "start":
			return span.startOffsetMs;
		case "end":
			return span.startOffsetMs + span.durationMs;
	}
}

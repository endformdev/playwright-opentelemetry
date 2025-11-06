import type { Span } from "./reporter";

export async function sendSpans(spans: Span[]): Promise<void> {
	// TODO: Implement actual OpenTelemetry HTTP JSON protocol
	console.log("Sending spans:", JSON.stringify(spans, null, 2));
}

import type { ResolvedPlaywrightOpentelemetryDestination } from "./config";
import type { PlaywrightTraceOption } from "./playwright-trace";

export function filterRetainedDestinations(
	destinations: ResolvedPlaywrightOpentelemetryDestination[],
	configTrace: PlaywrightTraceOption | null,
	shouldRetainTrace: (trace: PlaywrightTraceOption | null) => boolean,
): ResolvedPlaywrightOpentelemetryDestination[] {
	return destinations.filter(
		(destination) =>
			destination.url && shouldRetainTrace(destination.trace ?? configTrace),
	);
}

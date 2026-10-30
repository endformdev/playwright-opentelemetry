import type { ResolvedPlaywrightOpentelemetryDestination } from "./config";
import type { PlaywrightTraceOption } from "./playwright-trace";

/**
 * Destinations that receive a test's data once it ends. Live destinations are
 * streamed separately while the test runs.
 */
export function filterRetainedDestinations(
	destinations: ResolvedPlaywrightOpentelemetryDestination[],
	configTrace: PlaywrightTraceOption | null,
	shouldRetainTrace: (trace: PlaywrightTraceOption | null) => boolean,
): ResolvedPlaywrightOpentelemetryDestination[] {
	return destinations.filter(
		(destination) =>
			destination.url &&
			!destination.live &&
			shouldRetainTrace(destination.trace ?? configTrace),
	);
}

export function filterLiveDestinations(
	destinations: ResolvedPlaywrightOpentelemetryDestination[],
): ResolvedPlaywrightOpentelemetryDestination[] {
	return destinations.filter(
		(destination) => destination.url && destination.live,
	);
}

import type { Request, Route } from "@playwright/test";
import { generateSpanId } from "../shared/otel";
import type { TestTraceContext } from "./trace-context";

export interface PlaywrightFixturePropagatorOptions {
	route: Route;
	request: Request;
	traceContext: TestTraceContext;
	parentSpanId: string;
	routeAssociation: "active-route" | "active-page" | "root";
}

/**
 * Intercepts network requests to propagate trace context via traceparent header.
 * @param options - The propagator options
 */
export async function fixtureOtelHeaderPropagator({
	route,
	request,
	traceContext,
	parentSpanId,
	routeAssociation,
}: PlaywrightFixturePropagatorOptions): Promise<void> {
	const spanId = generateSpanId();
	const traceHeader = `00-${traceContext.traceId}-${spanId}-01`;

	traceContext.requestContexts.set(request, {
		traceId: traceContext.traceId,
		spanId,
		parentSpanId,
		routeAssociation,
	});

	await route.fallback({
		headers: {
			...request.headers(),
			traceparent: traceHeader,
		},
	});
}

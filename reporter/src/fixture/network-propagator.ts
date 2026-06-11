import type { Request, Route } from "@playwright/test";
import { generateSpanId } from "../shared/otel";
import type { TestTraceContext } from "./trace-context";

export interface StoreRequestTraceContextOptions {
	request: Request;
	traceContext: TestTraceContext;
	parentSpanId: string;
	routeAssociation: "active-route" | "active-page" | "root";
}

export interface PropagateRouteTraceHeadersOptions {
	route: Route;
	request: Request;
	traceId: string;
	spanId: string;
}

export function storeRequestTraceContext({
	request,
	traceContext,
	parentSpanId,
	routeAssociation,
}: StoreRequestTraceContextOptions): string {
	const spanId = generateSpanId();

	traceContext.requestContexts.set(request, {
		traceId: traceContext.traceId,
		spanId,
		parentSpanId,
		routeAssociation,
	});

	return spanId;
}

/**
 * Intercepts network requests to propagate trace context via traceparent header.
 * @param options - The propagator options
 */
export async function propagateRouteTraceHeaders({
	route,
	request,
	traceId,
	spanId,
}: PropagateRouteTraceHeadersOptions): Promise<void> {
	const traceHeader = `00-${traceId}-${spanId}-01`;

	await route.fallback({
		headers: {
			...request.headers(),
			traceparent: traceHeader,
		},
	});
}

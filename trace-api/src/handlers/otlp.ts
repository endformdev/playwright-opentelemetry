import type { EventHandler } from "h3";
import { defineEventHandler, readBody } from "h3";
import type { TraceStorage } from "../storage/s3";

interface OtlpPayload {
	resourceSpans?: Array<{
		resource?: {
			attributes?: Array<{
				key: string;
				value?: { stringValue?: string };
			}>;
		};
		scopeSpans?: Array<{
			spans?: Array<{
				traceId?: string;
				spanId?: string;
			}>;
		}>;
	}>;
}

/**
 * Create a handler for the standard OTLP trace endpoint.
 *
 * Receives OTLP JSON payloads at POST /v1/traces, extracts traceId and
 * service.name from each resourceSpan, and writes to storage at:
 * `traces/{traceId}/opentelemetry-protocol/{serviceName}-{spanId}.json`
 *
 * @param storage - TraceStorage implementation
 * @returns H3 event handler
 *
 * @example
 * ```ts
 * import { OTLP_TRACES_WRITE_PATH } from '@playwright-opentelemetry/trace-api';
 *
 * const router = createRouter();
 * // OTLP_TRACES_WRITE_PATH = '/v1/traces'
 * router.post(OTLP_TRACES_WRITE_PATH, createOtlpHandler(storage));
 * ```
 */
export function createOtlpHandler(storage: TraceStorage): EventHandler {
	return defineEventHandler(async (event) => {
		const payload = (await readBody(event)) as OtlpPayload;

		// Extract first available service name, span ID, and trace ID
		let serviceName = "unknown";
		let spanId = "unknown";
		let traceId = "unknown";

		for (const resourceSpan of payload.resourceSpans || []) {
			// Extract service.name from resource attributes
			if (resourceSpan.resource?.attributes) {
				for (const attr of resourceSpan.resource.attributes) {
					if (attr.key === "service.name" && attr.value?.stringValue) {
						serviceName = attr.value.stringValue;
						break;
					}
				}
			}

			// Extract first span's traceId and spanId
			for (const scopeSpan of resourceSpan.scopeSpans || []) {
				for (const span of scopeSpan.spans || []) {
					if (span.traceId) {
						traceId = span.traceId;
					}
					if (span.spanId) {
						spanId = span.spanId;
					}
					if (traceId !== "unknown" && spanId !== "unknown") {
						break;
					}
				}
				if (traceId !== "unknown" && spanId !== "unknown") {
					break;
				}
			}

			if (
				serviceName !== "unknown" &&
				traceId !== "unknown" &&
				spanId !== "unknown"
			) {
				break;
			}
		}

		// Store the payload
		const filename = `${serviceName}-${spanId}.json`;
		const path = `traces/${traceId}/opentelemetry-protocol/${filename}`;

		await storage.put(path, JSON.stringify(payload), "application/json");

		return { status: "ok" };
	});
}

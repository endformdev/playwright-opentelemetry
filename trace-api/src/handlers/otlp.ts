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

		// Group spans by traceId to handle multiple traces in a single POST
		const traceGroups = new Map<
			string,
			{
				serviceName: string;
				spanId: string;
				resourceSpans: OtlpPayload["resourceSpans"];
			}
		>();

		for (const resourceSpan of payload.resourceSpans || []) {
			// Extract service.name from resource attributes
			let serviceName = "unknown";
			if (resourceSpan.resource?.attributes) {
				for (const attr of resourceSpan.resource.attributes) {
					if (attr.key === "service.name" && attr.value?.stringValue) {
						serviceName = attr.value.stringValue;
						break;
					}
				}
			}

			// Process each span and group by traceId
			for (const scopeSpan of resourceSpan.scopeSpans || []) {
				// Group spans within this scopeSpan by traceId
				const spansByTrace = new Map<
					string,
					Array<{ traceId?: string; spanId?: string }>
				>();

				for (const span of scopeSpan.spans || []) {
					const traceId = span.traceId || "unknown";
					if (!spansByTrace.has(traceId)) {
						spansByTrace.set(traceId, []);
					}
					spansByTrace.get(traceId)?.push(span);
				}

				// Create separate payloads for each traceId
				for (const [traceId, spans] of spansByTrace) {
					if (traceId === "unknown") continue;

					const spanId = spans[0]?.spanId || "unknown";

					if (!traceGroups.has(traceId)) {
						traceGroups.set(traceId, {
							serviceName,
							spanId,
							resourceSpans: [
								{
									resource: resourceSpan.resource,
									scopeSpans: [
										{
											...scopeSpan,
											spans,
										},
									],
								},
							],
						});
					} else {
						// Append to existing trace group
						const group = traceGroups.get(traceId);
						if (group?.resourceSpans?.[0]?.scopeSpans) {
							group.resourceSpans[0].scopeSpans.push({
								...scopeSpan,
								spans,
							});
						}
					}
				}
			}
		}

		// Store each trace group separately
		const storePromises: Promise<void>[] = [];
		for (const [traceId, group] of traceGroups) {
			const filename = `${group.serviceName}-${group.spanId}.json`;
			const path = `traces/${traceId}/opentelemetry-protocol/${filename}`;

			const tracePayload = {
				resourceSpans: group.resourceSpans,
			};

			storePromises.push(
				storage.put(path, JSON.stringify(tracePayload), "application/json"),
			);
		}

		await Promise.all(storePromises);

		return { status: "ok" };
	});
}

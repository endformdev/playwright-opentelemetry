import type { H3Event } from "h3";
import { handleCors } from "h3";

/**
 * Apply CORS handling to an H3 event if corsOrigin is configured.
 * Returns a response if this is a preflight request, undefined otherwise.
 */
export function applyCors(
	event: H3Event,
	corsOrigin?: string | false,
): unknown {
	if (!corsOrigin) {
		return undefined;
	}

	const corsResponse = handleCors(event, {
		origin: corsOrigin as "*",
		methods: "*" as const,
		preflight: {
			statusCode: 204,
		},
	});

	return corsResponse || undefined;
}

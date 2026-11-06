/** Why the trace API turned the viewer away, when it says so. */
export type TraceAccessFailure =
	| { code: "token_expired"; expiredAt: Date | null }
	| { code: "token_invalid" }
	| { code: "token_wrong_trace" }
	| { code: "token_missing" };

export class TraceAccessError extends Error {
	readonly failure: TraceAccessFailure;

	constructor(failure: TraceAccessFailure) {
		super(`The trace API refused access: ${failure.code}`);
		this.name = "TraceAccessError";
		this.failure = failure;
	}
}

/**
 * Reads the reason out of a refused response. Responses without a known `code`
 * give null, as a 401 alone doesn't say what went wrong.
 */
export function parseTraceAccessFailure(
	status: number,
	body: string,
): TraceAccessFailure | null {
	if (status !== 401 && status !== 403) return null;

	const denial = parseJsonObject(body);
	switch (denial?.code) {
		case "token_expired":
			return { code: "token_expired", expiredAt: parseDate(denial.expiredAt) };
		case "token_invalid":
		case "token_wrong_trace":
		case "token_missing":
			return { code: denial.code };
		default:
			return null;
	}
}

function parseJsonObject(body: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(body);
		return typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function parseDate(value: unknown): Date | null {
	if (typeof value !== "string") return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

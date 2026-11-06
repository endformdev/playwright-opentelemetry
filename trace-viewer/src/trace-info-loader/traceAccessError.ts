/** Why the trace API turned the viewer away, when it says so. */
export type TraceAccessFailure =
	| { code: "token_expired"; expiredAt: Date | null }
	| { code: "token_invalid" }
	| { code: "token_missing" };

export class TraceAccessError extends Error {
	readonly failure: TraceAccessFailure;

	constructor(failure: TraceAccessFailure) {
		super(`The trace API refused access: ${failure.code}`);
		this.name = "TraceAccessError";
		this.failure = failure;
	}
}

/** Reads the reason out of a refused response, or null if it doesn't give one. */
export function parseTraceAccessFailure(
	body: string,
): TraceAccessFailure | null {
	const denial = parseJson(body);
	switch (denial?.code) {
		case "token_expired":
			return { code: "token_expired", expiredAt: parseDate(denial.expiredAt) };
		case "token_invalid":
		case "token_missing":
			return { code: denial.code };
		default:
			return null;
	}
}

function parseJson(
	body: string,
): { code?: unknown; expiredAt?: unknown } | null {
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
}

function parseDate(value: unknown): Date | null {
	const date = new Date(typeof value === "string" ? value : Number.NaN);
	return Number.isNaN(date.getTime()) ? null : date;
}

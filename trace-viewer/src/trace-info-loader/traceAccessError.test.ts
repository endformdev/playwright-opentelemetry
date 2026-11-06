import { describe, expect, it } from "vitest";
import { parseTraceAccessFailure } from "./traceAccessError";

describe("reading why the trace API refused access", () => {
	it("reads when a token expired", () => {
		const body = JSON.stringify({
			code: "token_expired",
			expiredAt: "2026-11-06T11:53:00.000Z",
		});

		expect(parseTraceAccessFailure(body)).toEqual({
			code: "token_expired",
			expiredAt: new Date("2026-11-06T11:53:00.000Z"),
		});
	});

	it("still reports an expired token when the time can't be read", () => {
		const body = JSON.stringify({ code: "token_expired", expiredAt: "soon" });

		expect(parseTraceAccessFailure(body)).toEqual({
			code: "token_expired",
			expiredAt: null,
		});
	});

	it.each([
		["an unknown code", JSON.stringify({ code: "token_stolen" })],
		["no JSON", "Unauthorized"],
	])("gives no reason for %s", (_case, body) => {
		expect(parseTraceAccessFailure(body)).toBeNull();
	});
});

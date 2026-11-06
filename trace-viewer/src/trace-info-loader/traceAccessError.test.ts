import { describe, expect, it } from "vitest";
import { parseTraceAccessFailure } from "./traceAccessError";

function parse(status: number, body: unknown) {
	return parseTraceAccessFailure(status, JSON.stringify(body));
}

describe("reading why the trace API refused access", () => {
	it("reads when a token expired", () => {
		expect(
			parse(401, {
				status: 401,
				message: "Unauthorized",
				code: "token_expired",
				expiredAt: "2026-11-06T11:53:00.000Z",
			}),
		).toEqual({
			code: "token_expired",
			expiredAt: new Date("2026-11-06T11:53:00.000Z"),
		});
	});

	it.each([
		["missing", {}],
		["null", { expiredAt: null }],
		["not a date", { expiredAt: "soon" }],
		["not a string", { expiredAt: 1793966004 }],
	])("still reports an expired token when the time is %s", (_case, fields) => {
		expect(parse(401, { code: "token_expired", ...fields })).toEqual({
			code: "token_expired",
			expiredAt: null,
		});
	});

	it.each([
		[401, "token_invalid"],
		[401, "token_missing"],
		[403, "token_wrong_trace"],
	])("reads a %i with code %s", (status, code) => {
		expect(parse(status, { code })).toEqual({ code });
	});

	it.each([
		["has no code", 401, JSON.stringify({ message: "Unauthorized" })],
		["has an unknown code", 401, JSON.stringify({ code: "token_stolen" })],
		["isn't JSON", 401, "Unauthorized"],
		["is JSON null", 401, "null"],
		["isn't a refusal", 500, JSON.stringify({ code: "token_expired" })],
	])("gives no reason when the response %s", (_case, status, body) => {
		expect(parseTraceAccessFailure(status, body)).toBeNull();
	});
});

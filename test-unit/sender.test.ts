import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Span } from "../src/reporter";
import { type SendSpansOptions, sendSpans } from "../src/sender";

const defaultOptions: SendSpansOptions = {
	tracesEndpoint: "http://localhost:4318/v1/traces",
	playwrightVersion: "1.56.1",
	debug: true,
};

describe("sendSpans", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = mockFetch;
	});

	test("sends spans to default endpoint with correct OTLP format", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
		});

		const spans: Span[] = [
			{
				traceId: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
				spanId: "1234567890abcdef",
				name: "test span",
				startTime: new Date("2001-09-09T01:46:40.000Z"),
				endTime: new Date("2001-09-09T01:46:40.500Z"),
				attributes: {
					"test.name": "example",
					"test.count": 42,
				},
				status: { code: 1 },
			},
		];

		await sendSpans(spans, defaultOptions);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(mockFetch).toHaveBeenCalledWith("http://localhost:4318/v1/traces", {
			method: "POST",
			body: expect.any(String),
			headers: {
				"content-type": "application/json",
			},
		});

		const callArgs = mockFetch.mock.calls[0];
		const body = JSON.parse(callArgs[1].body);

		expect(body).toEqual({
			resourceSpans: [
				{
					resource: {
						attributes: [
							{
								key: "service.name",
								value: { stringValue: "playwright-tests" },
							},
							{
								key: "service.namespace",
								value: { stringValue: "playwright" },
							},
							{
								key: "service.version",
								value: { stringValue: expect.any(String) },
							},
						],
					},
					scopeSpans: [
						{
							scope: {
								name: "playwright-opentelemetry",
								version: expect.any(String),
							},
							spans: [
								{
									traceId: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
									spanId: "1234567890abcdef",
									parentSpanId: undefined,
									name: "test span",
									kind: 1,
									startTimeUnixNano: "1000000000000000000",
									endTimeUnixNano: "1000000000500000000",
									attributes: [
										{ key: "test.name", value: { stringValue: "example" } },
										{ key: "test.count", value: { intValue: 42 } },
									],
									droppedAttributesCount: 0,
									events: [],
									droppedEventsCount: 0,
									status: { code: 1 },
									links: [],
									droppedLinksCount: 0,
								},
							],
						},
					],
				},
			],
		});
	});

	test("sends spans to custom endpoint", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
		});

		const spans: Span[] = [
			{
				traceId: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
				spanId: "1234567890abcdef",
				name: "test span",
				startTime: new Date("2001-09-09T01:46:40.000Z"),
				endTime: new Date("2001-09-09T01:46:40.500Z"),
				attributes: {},
				status: { code: 1 },
			},
		];

		await sendSpans(spans, {
			tracesEndpoint: "https://api.honeycomb.io/v1/traces",
			playwrightVersion: "1.56.1",
		});

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.honeycomb.io/v1/traces",
			expect.objectContaining({
				method: "POST",
			}),
		);
	});

	test("sends custom headers", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
		});

		const spans: Span[] = [
			{
				traceId: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
				spanId: "1234567890abcdef",
				name: "test span",
				startTime: new Date("2001-09-09T01:46:40.000Z"),
				endTime: new Date("2001-09-09T01:46:40.500Z"),
				attributes: {},
				status: { code: 1 },
			},
		];

		await sendSpans(spans, {
			tracesEndpoint: "https://api.honeycomb.io/v1/traces",
			headers: {
				"x-honeycomb-team": "my-api-key",
				"x-custom-header": "custom-value",
			},
			playwrightVersion: "1.56.1",
		});

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.honeycomb.io/v1/traces",
			{
				method: "POST",
				body: expect.any(String),
				headers: {
					"content-type": "application/json",
					"x-honeycomb-team": "my-api-key",
					"x-custom-header": "custom-value",
				},
			},
		);
	});

	test("handles span with parentSpanId", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
		});

		const spans: Span[] = [
			{
				traceId: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
				spanId: "1234567890abcdef",
				parentSpanId: "fedcba0987654321",
				name: "child span",
				startTime: new Date("2001-09-09T01:46:40.000Z"),
				endTime: new Date("2001-09-09T01:46:40.500Z"),
				attributes: {},
				status: { code: 1 },
			},
		];

		await sendSpans(spans, defaultOptions);

		const callArgs = mockFetch.mock.calls[0];
		const body = JSON.parse(callArgs[1].body);

		expect(body.resourceSpans[0].scopeSpans[0].spans[0].parentSpanId).toBe(
			"fedcba0987654321",
		);
	});

	test("handles multiple spans", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
		});

		const spans: Span[] = [
			{
				traceId: "trace1",
				spanId: "span1",
				name: "first span",
				startTime: new Date("2001-09-09T01:46:40.000Z"),
				endTime: new Date("2001-09-09T01:46:40.500Z"),
				attributes: {},
				status: { code: 1 },
			},
			{
				traceId: "trace2",
				spanId: "span2",
				name: "second span",
				startTime: new Date("2001-09-09T01:46:42.000Z"),
				endTime: new Date("2001-09-09T01:46:42.500Z"),
				attributes: { "test.attr": "value" },
				status: { code: 2 },
			},
		];

		await sendSpans(spans, defaultOptions);

		const callArgs = mockFetch.mock.calls[0];
		const body = JSON.parse(callArgs[1].body);

		expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
		expect(body.resourceSpans[0].scopeSpans[0].spans[0].name).toBe(
			"first span",
		);
		expect(body.resourceSpans[0].scopeSpans[0].spans[1].name).toBe(
			"second span",
		);
	});

	test("handles empty spans array", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
		});

		await sendSpans([], defaultOptions);

		expect(mockFetch).not.toHaveBeenCalled();
	});

	test("handles different attribute types", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
		});

		const spans: Span[] = [
			{
				traceId: "trace1",
				spanId: "span1",
				name: "span with various attributes",
				startTime: new Date("2001-09-09T01:46:40.000Z"),
				endTime: new Date("2001-09-09T01:46:40.500Z"),
				attributes: {
					"string.attr": "text",
					"int.attr": 123,
					"bool.attr": true,
				},
				status: { code: 1 },
			},
		];

		await sendSpans(spans, defaultOptions);

		const callArgs = mockFetch.mock.calls[0];
		const body = JSON.parse(callArgs[1].body);
		const attributes = body.resourceSpans[0].scopeSpans[0].spans[0].attributes;

		expect(attributes).toEqual([
			{ key: "string.attr", value: { stringValue: "text" } },
			{ key: "int.attr", value: { intValue: 123 } },
			{ key: "bool.attr", value: { boolValue: true } },
		]);
	});

	test("throws error when fetch fails", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			text: async () => "Server error details",
		});

		const spans: Span[] = [
			{
				traceId: "trace1",
				spanId: "span1",
				name: "test span",
				startTime: new Date("2001-09-09T01:46:40.000Z"),
				endTime: new Date("2001-09-09T01:46:40.500Z"),
				attributes: {},
				status: { code: 1 },
			},
		];

		await expect(sendSpans(spans, defaultOptions)).rejects.toThrow(
			"Failed to send spans: 500 Internal Server Error, Server error details",
		);
	});

	test("throws error when fetch throws", async () => {
		mockFetch.mockRejectedValue(new Error("Network error"));

		const spans: Span[] = [
			{
				traceId: "trace1",
				spanId: "span1",
				name: "test span",
				startTime: new Date("2001-09-09T01:46:40.000Z"),
				endTime: new Date("2001-09-09T01:46:40.500Z"),
				attributes: {},
				status: { code: 1 },
			},
		];

		await expect(sendSpans(spans, defaultOptions)).rejects.toThrow(
			"Network error",
		);
	});

	test("uses playwright version as service.version when provided", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
		});

		const spans: Span[] = [
			{
				traceId: "trace1",
				spanId: "span1",
				name: "test span",
				startTime: new Date("2001-09-09T01:46:40.000Z"),
				endTime: new Date("2001-09-09T01:46:40.500Z"),
				attributes: {},
				status: { code: 1 },
			},
		];

		await sendSpans(spans, {
			...defaultOptions,
			playwrightVersion: "1.56.1",
		});

		const callArgs = mockFetch.mock.calls[0];
		const body = JSON.parse(callArgs[1].body);

		const serviceVersionAttr = body.resourceSpans[0].resource.attributes.find(
			(attr: { key: string }) => attr.key === "service.version",
		);

		expect(serviceVersionAttr.value.stringValue).toBe("1.56.1");
	});
});

import { describe, expect, it } from "vitest";
import {
	createInMemoryStorage,
	createOtlpPayload,
	createTestHarness,
	createTestHarnessWithStorage,
	generateTraceId,
} from "./testHarness";

const VIEWER_PATH = "/playwright-otel-trace-viewer";

describe("reading trace data through the viewer API", () => {
	it("shows Playwright and backend spans that arrive in separate OTLP batches", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		await postOtlp(
			app,
			createOtlpPayload({
				traceId,
				serviceName: "backend-api",
				spans: [span("HTTP GET /api/users"), span("database query")],
			}),
		);
		await postOtlp(
			app,
			createOtlpPayload({
				traceId,
				serviceName: "playwright-tests",
				spans: [span("playwright.test"), span("playwright.test.step")],
			}),
		);

		const response = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/traces`),
		);

		expect(response.status).toBe(200);
		expect(spanNames(await response.json())).toEqual([
			"HTTP GET /api/users",
			"database query",
			"playwright.test",
			"playwright.test.step",
		]);
	});

	it("keeps traces isolated when a backend exporter batches multiple trace IDs together", async () => {
		const app = createTestHarness();
		const traceA = generateTraceId();
		const traceB = generateTraceId();
		const payload = createOtlpPayload({
			traceId: traceA,
			serviceName: "backend-api",
			spans: [span("trace A HTTP request")],
		});
		payload.resourceSpans[0].scopeSpans[0].spans.push({
			...span("trace B HTTP request"),
			traceId: traceB,
		});

		await postOtlp(app, payload);

		expect(await readSpanNames(app, traceA)).toEqual(["trace A HTTP request"]);
		expect(await readSpanNames(app, traceB)).toEqual(["trace B HTTP request"]);
	});

	it("preserves multi-resource and multi-scope OTLP structure in the returned trace", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		await postOtlp(app, {
			resourceSpans: [
				resourceSpan("playwright-tests", [
					scopeSpan("playwright-opentelemetry", [
						span("playwright.test", traceId),
					]),
				]),
				resourceSpan("backend-api", [
					scopeSpan("http", [span("GET /checkout", traceId)]),
					scopeSpan("db", [span("SELECT cart", traceId)]),
				]),
			],
		});

		const response = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/traces`),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(serviceNames(body)).toEqual([
			"playwright-tests",
			"backend-api",
			"backend-api",
		]);
		expect(scopeNames(body)).toEqual([
			"playwright-opentelemetry",
			"http",
			"db",
		]);
		expect(spanNames(body)).toEqual([
			"playwright.test",
			"GET /checkout",
			"SELECT cart",
		]);
	});

	it("returns 404 when a user opens a trace ID that has no stored trace fragments", async () => {
		const app = createTestHarness();
		const response = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${generateTraceId()}/traces`),
		);

		expect(response.status).toBe(404);
	});

	it("does not expose the old file-listing trace API", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		for (const path of [
			`${VIEWER_PATH}/${traceId}/opentelemetry-protocol`,
			`${VIEWER_PATH}/${traceId}/opentelemetry-protocol/playwright.json`,
			`${VIEWER_PATH}/${traceId}/test.json`,
		]) {
			const response = await app.fetch(new Request(`http://localhost${path}`));
			expect(response.status).toBe(404);
		}
	});

	it("fails the trace read when a stored fragment is corrupt", async () => {
		const storage = createInMemoryStorage();
		const app = createTestHarnessWithStorage(storage);
		const traceId = generateTraceId();

		await storage.put(
			`traces/${traceId}/traces/corrupt.json`,
			"not json",
			"application/json",
		);

		const response = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/traces`),
		);

		expect(response.status).toBe(500);
	});
});

async function postOtlp(
	app: ReturnType<typeof createTestHarness>,
	payload: unknown,
) {
	const response = await app.fetch(
		new Request("http://localhost/v1/traces", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}),
	);
	expect(response.status).toBe(200);
}

async function readSpanNames(
	app: ReturnType<typeof createTestHarness>,
	traceId: string,
) {
	const response = await app.fetch(
		new Request(`http://localhost${VIEWER_PATH}/${traceId}/traces`),
	);
	expect(response.status).toBe(200);
	return spanNames(await response.json());
}

function span(name: string, traceId?: string) {
	return {
		traceId,
		spanId: name
			.replace(/[^a-z0-9]/gi, "")
			.padEnd(16, "0")
			.slice(0, 16),
		parentSpanId: undefined,
		name,
		kind: 1,
		startTimeUnixNano: "1766927492000000000",
		endTimeUnixNano: "1766927493000000000",
		attributes: [],
		status: { code: 1 },
	};
}

function resourceSpan(serviceName: string, scopeSpans: unknown[]) {
	return {
		resource: {
			attributes: [
				{ key: "service.name", value: { stringValue: serviceName } },
			],
		},
		scopeSpans,
	};
}

function scopeSpan(name: string, spans: unknown[]) {
	return { scope: { name }, spans };
}

interface TraceResponse {
	resourceSpans: Array<{
		resource: {
			attributes: Array<{ key: string; value: { stringValue?: string } }>;
		};
		scopeSpans: Array<{
			scope: { name: string };
			spans: Array<{ name: string }>;
		}>;
	}>;
}

function spanNames(payload: unknown): string[] {
	const trace = payload as TraceResponse;
	return trace.resourceSpans.flatMap((resourceSpan) =>
		resourceSpan.scopeSpans.flatMap((scopeSpan) =>
			scopeSpan.spans.map((span) => span.name),
		),
	);
}

function serviceNames(payload: unknown): string[] {
	const trace = payload as TraceResponse;
	return trace.resourceSpans.flatMap((resourceSpan) => {
		const serviceName = resourceSpan.resource.attributes.find(
			(attribute) => attribute.key === "service.name",
		)?.value.stringValue;
		return serviceName === undefined ? [] : [serviceName];
	});
}

function scopeNames(payload: unknown): string[] {
	const trace = payload as TraceResponse;
	return trace.resourceSpans.flatMap((resourceSpan) =>
		resourceSpan.scopeSpans.map((scopeSpan) => scopeSpan.scope.name),
	);
}

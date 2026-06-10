import { describe, expect, it } from "vitest";
import {
	createOtlpPayload,
	createRrwebBuffer,
	createTestHarness,
	generateTraceId,
} from "./testHarness";

const VIEWER_PATH = "/playwright-otel-trace-viewer/v1";
const REPORTER_PATH = "/playwright-otel-reporter/v1";

describe("Trace API", () => {
	it("stores and returns merged OTLP traces by trace ID", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		await postOtlp(
			app,
			createOtlpPayload({
				traceId,
				serviceName: "playwright-tests",
				spans: [span("playwright.test", "testspan0000001")],
			}),
		);
		await postOtlp(
			app,
			createOtlpPayload({
				traceId,
				serviceName: "backend-api",
				spans: [span("GET /api/users", "backend000000001")],
			}),
		);

		const response = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/traces`),
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as TraceResponse;
		expect(body.resourceSpans).toHaveLength(2);
		expect(allSpanNames(body)).toEqual(
			expect.arrayContaining(["playwright.test", "GET /api/users"]),
		);
	});

	it("partitions one OTLP request that contains multiple trace IDs", async () => {
		const app = createTestHarness();
		const traceA = generateTraceId();
		const traceB = generateTraceId();
		const payload = createOtlpPayload({
			traceId: traceA,
			spans: [span("trace A", "aaaaaaaaaaaaaaaa")],
		});
		payload.resourceSpans[0].scopeSpans[0].spans.push({
			...span("trace B", "bbbbbbbbbbbbbbbb"),
			traceId: traceB,
		});

		await postOtlp(app, payload);

		const traceAResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceA}/traces`),
		);
		const traceBResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceB}/traces`),
		);

		expect(allSpanNames(await traceAResponse.json())).toEqual(["trace A"]);
		expect(allSpanNames(await traceBResponse.json())).toEqual(["trace B"]);
	});

	it("returns 404 for missing traces and unsupported old read endpoints", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();

		const missingResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/traces`),
		);
		const oldListResponse = await app.fetch(
			new Request(
				`http://localhost${VIEWER_PATH}/${traceId}/opentelemetry-protocol`,
			),
		);
		const oldTestResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/test.json`),
		);

		expect(missingResponse.status).toBe(404);
		expect(oldListResponse.status).toBe(404);
		expect(oldTestResponse.status).toBe(404);
	});

	it("stores and serves rrweb ZIP through the reporter and viewer paths", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();
		const buffer = createRrwebBuffer("rrweb.zip");

		const uploadResponse = await app.fetch(
			new Request(`http://localhost${REPORTER_PATH}/rrweb.zip`, {
				method: "PUT",
				headers: { "X-Trace-Id": traceId, "Content-Type": "application/zip" },
				body: buffer,
			}),
		);
		const zipResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/rrweb.zip`),
		);

		expect(uploadResponse.status).toBe(200);
		expect(zipResponse.status).toBe(200);
		expect(zipResponse.headers.get("content-type")).toBe("application/zip");
		expect(await zipResponse.arrayBuffer()).toEqual(buffer);
	});

	it("isolates traces with resolvePath", async () => {
		const app = createTestHarness({
			resolvePath(event, path) {
				return `${event.req.headers.get("x-org-id")}/${path}`;
			},
		});
		const traceId = generateTraceId();

		await postOtlp(
			app,
			createOtlpPayload({
				traceId,
				serviceName: "org-a-service",
				spans: [span("org A", "aaaaaaaaaaaaaaaa")],
			}),
			{ "X-Org-Id": "org-a" },
		);
		await postOtlp(
			app,
			createOtlpPayload({
				traceId,
				serviceName: "org-b-service",
				spans: [span("org B", "bbbbbbbbbbbbbbbb")],
			}),
			{ "X-Org-Id": "org-b" },
		);

		const orgAResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/traces`, {
				headers: { "X-Org-Id": "org-a" },
			}),
		);
		const orgBResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/traces`, {
				headers: { "X-Org-Id": "org-b" },
			}),
		);

		expect(allSpanNames(await orgAResponse.json())).toEqual(["org A"]);
		expect(allSpanNames(await orgBResponse.json())).toEqual(["org B"]);
	});
});

async function postOtlp(
	app: ReturnType<typeof createTestHarness>,
	payload: unknown,
	headers: Record<string, string> = {},
) {
	const response = await app.fetch(
		new Request("http://localhost/v1/traces", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(payload),
		}),
	);
	expect(response.status).toBe(200);
}

function span(name: string, spanId: string) {
	return {
		name,
		spanId,
		parentSpanId: undefined,
		kind: 1,
		startTimeUnixNano: "1766927492000000000",
		endTimeUnixNano: "1766927493000000000",
		attributes: [],
		status: { code: 1 },
	};
}

interface TraceResponse {
	resourceSpans: Array<{
		scopeSpans: Array<{
			spans: Array<{ name: string }>;
		}>;
	}>;
}

function allSpanNames(payload: unknown): string[] {
	const trace = payload as TraceResponse;
	return trace.resourceSpans.flatMap((resourceSpan) =>
		resourceSpan.scopeSpans.flatMap((scopeSpan) =>
			scopeSpan.spans.map((span) => span.name),
		),
	);
}

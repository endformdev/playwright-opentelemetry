import type { H3Event } from "h3";
import { describe, expect, it } from "vitest";
import {
	createOtlpPayload,
	createRrwebBuffer,
	createTestHarness,
	generateTraceId,
} from "./testHarness";

const REPORTER_PATH = "/playwright-otel-reporter/v1";
const VIEWER_PATH = "/playwright-otel-trace-viewer/v1";

describe("multi-tenant trace API flows", () => {
	it("keeps two tenants with the same trace ID from seeing each other's traces or rrweb recordings", async () => {
		const app = createTestHarness({ resolvePath: tenantPath });
		const traceId = generateTraceId();

		await postTenantTrace(app, "org-a", traceId, "org A checkout");
		await postTenantTrace(app, "org-b", traceId, "org B checkout");
		const orgARrwebZip = createRrwebBuffer("org-a-rrweb.zip");
		const orgBRrwebZip = createRrwebBuffer("org-b-rrweb.zip");

		await uploadTenantRrwebZip(app, "org-a", traceId, orgARrwebZip);
		await uploadTenantRrwebZip(app, "org-b", traceId, orgBRrwebZip);

		expect(await readTenantSpanNames(app, "org-a", traceId)).toEqual([
			"org A checkout",
		]);
		expect(await readTenantSpanNames(app, "org-b", traceId)).toEqual([
			"org B checkout",
		]);
		expect(await readTenantRrwebZip(app, "org-a", traceId)).toEqual(
			orgARrwebZip,
		);
		expect(await readTenantRrwebZip(app, "org-b", traceId)).toEqual(
			orgBRrwebZip,
		);
	});
});

function tenantPath(event: H3Event, path: string): string {
	const orgId = event.req.headers.get("x-org-id");
	if (!orgId) throw new Error("X-Org-Id header is required");
	return `orgs/${orgId}/${path}`;
}

async function postTenantTrace(
	app: ReturnType<typeof createTestHarness>,
	orgId: string,
	traceId: string,
	name: string,
) {
	const response = await app.fetch(
		new Request("http://localhost/v1/traces", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Org-Id": orgId },
			body: JSON.stringify(
				createOtlpPayload({
					traceId,
					serviceName: `${orgId}-service`,
					spans: [
						{
							name,
							startTimeUnixNano: "1766927492000000000",
							endTimeUnixNano: "1766927493000000000",
						},
					],
				}),
			),
		}),
	);
	expect(response.status).toBe(200);
}

async function uploadTenantRrwebZip(
	app: ReturnType<typeof createTestHarness>,
	orgId: string,
	traceId: string,
	body: ArrayBuffer,
) {
	const response = await app.fetch(
		new Request(`http://localhost${REPORTER_PATH}/rrweb.zip`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/zip",
				"X-Trace-Id": traceId,
				"X-Org-Id": orgId,
			},
			body,
		}),
	);
	expect(response.status).toBe(200);
}

async function readTenantSpanNames(
	app: ReturnType<typeof createTestHarness>,
	orgId: string,
	traceId: string,
) {
	const response = await app.fetch(
		new Request(`http://localhost${VIEWER_PATH}/${traceId}/traces`, {
			headers: { "X-Org-Id": orgId },
		}),
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as TraceResponse;
	return body.resourceSpans.flatMap((resourceSpan) =>
		resourceSpan.scopeSpans.flatMap((scopeSpan) =>
			scopeSpan.spans.map((span) => span.name),
		),
	);
}

interface TraceResponse {
	resourceSpans: Array<{
		scopeSpans: Array<{
			spans: Array<{ name: string }>;
		}>;
	}>;
}

async function readTenantRrwebZip(
	app: ReturnType<typeof createTestHarness>,
	orgId: string,
	traceId: string,
) {
	const response = await app.fetch(
		new Request(`http://localhost${VIEWER_PATH}/${traceId}/rrweb.zip`, {
			headers: { "X-Org-Id": orgId },
		}),
	);
	expect(response.status).toBe(200);
	return response.arrayBuffer();
}

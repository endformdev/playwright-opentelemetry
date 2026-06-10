import { describe, expect, it } from "vitest";
import {
	createRrwebBuffer,
	createTestHarness,
	generateTraceId,
} from "./testHarness";

const REPORTER_PATH = "/playwright-otel-reporter/v1";
const VIEWER_PATH = "/playwright-otel-trace-viewer/v1";

describe("reading rrweb recordings through the viewer API", () => {
	it("serves the rrweb ZIP uploaded by the reporter", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();
		const rrwebZip = createRrwebBuffer("rrweb.zip");

		const uploadResponse = await uploadRrwebZip(app, traceId, rrwebZip);

		const zipResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/rrweb.zip`),
		);

		expect(uploadResponse.status).toBe(200);
		expect(zipResponse.status).toBe(200);
		expect(zipResponse.headers.get("content-type")).toBe("application/zip");
		expect(await zipResponse.arrayBuffer()).toEqual(rrwebZip);
	});

	it("returns 404 when a trace has no rrweb ZIP", async () => {
		const app = createTestHarness();
		const response = await app.fetch(
			new Request(
				`http://localhost${VIEWER_PATH}/${generateTraceId()}/rrweb.zip`,
			),
		);

		expect(response.status).toBe(404);
	});
});

function uploadRrwebZip(
	app: ReturnType<typeof createTestHarness>,
	traceId: string,
	body: ArrayBuffer,
) {
	return app.fetch(
		new Request(`http://localhost${REPORTER_PATH}/rrweb.zip`, {
			method: "PUT",
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
			body,
		}),
	);
}

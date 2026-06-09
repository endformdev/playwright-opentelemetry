import { describe, expect, it } from "vitest";
import {
	createScreenshotBuffer,
	createTestHarness,
	generateTraceId,
} from "./testHarness";

const REPORTER_PATH = "/playwright-otel-reporter/v1";
const VIEWER_PATH = "/playwright-otel-trace-viewer/v1";

describe("reading screenshots through the viewer API", () => {
	it("serves the screenshots ZIP uploaded by the reporter", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();
		const screenshotsZip = createScreenshotBuffer("screenshots.zip");

		const uploadResponse = await uploadScreenshotsZip(
			app,
			traceId,
			screenshotsZip,
		);

		const zipResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/screenshots.zip`),
		);

		expect(uploadResponse.status).toBe(200);
		expect(zipResponse.status).toBe(200);
		expect(zipResponse.headers.get("content-type")).toBe("application/zip");
		expect(await zipResponse.arrayBuffer()).toEqual(screenshotsZip);
	});

	it("returns 404 when a trace has no screenshots ZIP", async () => {
		const app = createTestHarness();
		const response = await app.fetch(
			new Request(
				`http://localhost${VIEWER_PATH}/${generateTraceId()}/screenshots.zip`,
			),
		);

		expect(response.status).toBe(404);
	});
});

function uploadScreenshotsZip(
	app: ReturnType<typeof createTestHarness>,
	traceId: string,
	body: ArrayBuffer,
) {
	return app.fetch(
		new Request(`http://localhost${REPORTER_PATH}/screenshots.zip`, {
			method: "PUT",
			headers: { "Content-Type": "application/zip", "X-Trace-Id": traceId },
			body,
		}),
	);
}

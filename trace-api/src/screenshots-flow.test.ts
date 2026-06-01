import { describe, expect, it } from "vitest";
import {
	createScreenshotBuffer,
	createTestHarness,
	generateTraceId,
} from "./testHarness";

const REPORTER_PATH = "/playwright-otel-reporter/v1";
const VIEWER_PATH = "/playwright-otel-trace-viewer/v1";

describe("reading screenshots through the viewer API", () => {
	it("shows screenshots uploaded by the reporter in filmstrip order", async () => {
		const app = createTestHarness();
		const traceId = generateTraceId();
		const uploads = [
			"page@abc-1766927492300.jpeg",
			"page@abc-1766927492100.jpeg",
			"popup@def-1766927492200.jpeg",
		];

		for (const filename of uploads) {
			const response = await uploadScreenshot(app, traceId, filename);
			expect(response.status).toBe(200);
		}

		const listResponse = await app.fetch(
			new Request(`http://localhost${VIEWER_PATH}/${traceId}/screenshots`),
		);
		const imageResponse = await app.fetch(
			new Request(
				`http://localhost${VIEWER_PATH}/${traceId}/screenshots/${uploads[2]}`,
			),
		);

		expect(listResponse.status).toBe(200);
		expect(await listResponse.json()).toEqual({
			screenshots: [
				{ timestamp: 1766927492100, file: "page@abc-1766927492100.jpeg" },
				{ timestamp: 1766927492200, file: "popup@def-1766927492200.jpeg" },
				{ timestamp: 1766927492300, file: "page@abc-1766927492300.jpeg" },
			],
		});
		expect(imageResponse.status).toBe(200);
		expect(imageResponse.headers.get("content-type")).toBe("image/jpeg");
		expect(await imageResponse.arrayBuffer()).toEqual(
			createScreenshotBuffer(uploads[2]),
		);
	});

	it("shows an empty filmstrip when a trace has no screenshots", async () => {
		const app = createTestHarness();
		const response = await app.fetch(
			new Request(
				`http://localhost${VIEWER_PATH}/${generateTraceId()}/screenshots`,
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ screenshots: [] });
	});

	it("returns 404 when the viewer requests a screenshot that was not uploaded", async () => {
		const app = createTestHarness();
		const response = await app.fetch(
			new Request(
				`http://localhost${VIEWER_PATH}/${generateTraceId()}/screenshots/missing.jpeg`,
			),
		);

		expect(response.status).toBe(404);
	});
});

function uploadScreenshot(
	app: ReturnType<typeof createTestHarness>,
	traceId: string,
	filename: string,
) {
	return app.fetch(
		new Request(`http://localhost${REPORTER_PATH}/screenshots/${filename}`, {
			method: "PUT",
			headers: { "Content-Type": "image/jpeg", "X-Trace-Id": traceId },
			body: createScreenshotBuffer(filename),
		}),
	);
}

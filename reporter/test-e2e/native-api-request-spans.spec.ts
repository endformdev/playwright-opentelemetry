import { createServer, type Server } from "node:http";
import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

export const NATIVE_API_REQUEST_TRACE_TEST_NAME =
	"native Playwright request fixture trace";

test(
	NATIVE_API_REQUEST_TRACE_TEST_NAME,
	async ({ request, testTraceContext, page, context, browser, playwright }) => {
		const server = await startFixtureServer();
		try {
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("Fixture server did not bind to a TCP port");
			}

			const baseUrl = `http://127.0.0.1:${address.port}`;
			const getResponse = await request.get(
				`${baseUrl}/native-request?source=get`,
			);
			const postResponse = await test.step("Post native request", () =>
				request.post(`${baseUrl}/native-request?source=post`, {
					data: { source: "playwright-request" },
				}));

			expect(getResponse.status()).toBe(203);
			expect(await getResponse.text()).toBe("native GET response");
			expect(postResponse.status()).toBe(201);
			expect(await postResponse.text()).toBe("native POST response");

			// Requests carry the test's trace to the service that answers them.
			const traced = await request.get(
				`${baseUrl}/native-request?source=traceparent`,
			);
			const traceparent = await traced.text();
			expect(traceparent).toMatch(
				new RegExp(`^00-${testTraceContext.traceId}-[0-9a-f]{16}-01$`),
			);
			// Tells the trace viewer's test which span ID the server saw.
			await request.get(
				`${baseUrl}/native-request?source=saw-${traceparent.split("-")[2]}`,
			);

			// Every other way to an APIRequestContext.
			await page.request.get(`${baseUrl}/native-request?source=page`);
			await context.request.get(`${baseUrl}/native-request?source=context`);
			const newRequest = await playwright.request.newContext();
			await newRequest.get(`${baseUrl}/native-request?source=new-request`);
			await newRequest.dispose();
			const newContext = await browser.newContext();
			await newContext.request.get(
				`${baseUrl}/native-request?source=new-context`,
			);
			await newContext.close();
		} finally {
			await closeServer(server);
		}
	},
);

function startFixtureServer(): Promise<Server> {
	const server = createServer((request, response) => {
		if (request.url === "/native-request?source=get") {
			response.writeHead(203, { "content-type": "text/plain" });
			response.end("native GET response");
			return;
		}

		if (request.url === "/native-request?source=post") {
			response.writeHead(201, { "content-type": "application/json" });
			response.end("native POST response");
			return;
		}

		if (request.url === "/native-request?source=traceparent") {
			response.writeHead(200, { "content-type": "text/plain" });
			response.end(request.headers.traceparent ?? "none");
			return;
		}

		if (request.url?.startsWith("/native-request?source=")) {
			response.writeHead(200, { "content-type": "text/plain" });
			response.end("native response");
			return;
		}

		response.writeHead(404, { "content-type": "text/plain" });
		response.end("not found");
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve(server);
		});
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}

			resolve();
		});
	});
}

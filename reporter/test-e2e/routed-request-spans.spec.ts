import { createServer } from "node:http";
import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

for (const routing of ["none", "fallback", "continue", "fulfill"] as const) {
	test(`captures browser requests with ${routing} routing`, async ({
		page,
		testTraceContext,
	}) => {
		let scriptTraceparent: string | string[] | undefined;
		const server = createServer((request, response) => {
			if (request.url === "/app.js") {
				scriptTraceparent = request.headers.traceparent;
				response.writeHead(200, { "content-type": "application/javascript" });
				response.end("window.loaded = true;");
				return;
			}

			response.writeHead(200, { "content-type": "text/html" });
			response.end('<html><script src="/app.js"></script></html>');
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);

		try {
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("Fixture server did not bind to a TCP port");
			}

			if (routing !== "none") {
				await page.route("**/*", async (route) => {
					if (
						routing === "fulfill" &&
						route.request().resourceType() === "script"
					) {
						await route.fulfill({
							status: 404,
							contentType: "application/javascript",
							body: "/* injected failure */",
						});
						return;
					}

					if (routing === "fallback") {
						await route.fallback();
					} else {
						await route.continue();
					}
				});
			}

			await page.goto(`http://127.0.0.1:${address.port}`);
			await expect
				.poll(
					() =>
						testTraceContext.spans.filter((span) => span.name === "HTTP GET")
							.length,
				)
				.toBe(2);

			const script = testTraceContext.spans.find(
				(span) => span.attributes["url.path"] === "/app.js",
			)!;
			expect(script.attributes["http.response.status_code"]).toBe(
				routing === "fulfill" ? 404 : 200,
			);
			if (routing === "fulfill") {
				expect(script.status).toEqual({ code: 2 });
			}

			if (routing === "none" || routing === "fallback") {
				expect(scriptTraceparent).toBe(
					`00-${testTraceContext.traceId}-${script.spanId}-01`,
				);
			}

			await page.close();
			const documents = testTraceContext.spans.filter(
				(span) => span.name === "browser.page",
			);
			expect(documents).toHaveLength(1);
			expect(script.parentSpanId).toBe(documents[0].spanId);
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});
}

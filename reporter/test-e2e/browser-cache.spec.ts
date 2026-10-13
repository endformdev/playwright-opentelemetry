import { createServer } from "node:http";
import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

for (const propagateTraceHeaders of [false, true, undefined]) {
	test.describe(`trace header propagation: ${propagateTraceHeaders ?? "default"}`, () => {
		test.use({
			playwrightOpentelemetry: {
				storeTraceZip: true,
				propagateTraceHeaders,
			},
		});

		test("captures repeated fetches of a cacheable resource", async ({
			page,
			testTraceContext,
		}) => {
			const traceparents: (string | string[] | undefined)[] = [];
			const server = createServer((request, response) => {
				if (request.url === "/cached.txt") {
					traceparents.push(request.headers.traceparent);
					response.writeHead(200, {
						"cache-control": "public, max-age=3600",
						"content-type": "text/plain",
					});
					response.end("cached resource");
					return;
				}

				response.writeHead(200, { "content-type": "text/html" });
				response.end("<body>Cache regression test</body>");
			});
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);

			try {
				const address = server.address();
				if (!address || typeof address === "string") {
					throw new Error("Fixture server did not bind to a TCP port");
				}

				await page.goto(`http://127.0.0.1:${address.port}/`);
				const bodies = await page.evaluate(async () => {
					const results: string[] = [];
					for (let i = 0; i < 3; i++) {
						const response = await fetch("/cached.txt");
						results.push(await response.text());
					}
					return results;
				});
				expect(bodies).toEqual(Array(3).fill("cached resource"));

				const resourceSpans = () =>
					testTraceContext.spans.filter(
						(span) => span.attributes["url.path"] === "/cached.txt",
					);
				await expect.poll(() => resourceSpans().length).toBe(3);
				const spans = resourceSpans();
				expect(new Set(spans.map((span) => span.spanId)).size).toBe(3);
				for (const span of spans) {
					expect(span.name).toBe("HTTP GET");
					expect(span.traceId).toBe(testTraceContext.traceId);
					expect(span.attributes["http.response.status_code"]).toBe(200);
				}

				if (propagateTraceHeaders === false) {
					// All three fetches emit spans, but only the cache miss hits the server.
					expect(traceparents).toEqual([undefined]);
				} else {
					// Routing for propagation disables the HTTP cache, even by default.
					expect(traceparents).toEqual(
						spans.map(
							(span) => `00-${testTraceContext.traceId}-${span.spanId}-01`,
						),
					);
				}

				await page.close();
				const documents = testTraceContext.spans.filter(
					(span) => span.name === "browser.page",
				);
				expect(documents).toHaveLength(1);
				for (const span of spans) {
					expect(span.parentSpanId).toBe(documents[0].spanId);
				}
			} finally {
				await new Promise<void>((resolve, reject) => {
					server.close((error) => (error ? reject(error) : resolve()));
				});
			}
		});
	});
}

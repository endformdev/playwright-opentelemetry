import { createServer, type Server } from "node:http";
import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

test("records immutable script response headers", async ({
	page,
	testTraceContext,
}) => {
	const server = await startFixtureServer();
	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Fixture server did not bind to a TCP port");
		}

		await page.goto(`http://127.0.0.1:${address.port}/`);
		await expect(page.locator("body")).toHaveAttribute("data-script", "loaded");

		await expect
			.poll(
				() =>
					testTraceContext.spans.find(
						(span) => span.attributes["url.path"] === "/assets/app-hash.js",
					)?.attributes,
			)
			.toEqual(
				expect.objectContaining({
					"http.response.header.cache-control": [
						"public, max-age=31536000, immutable",
					],
					"http.response.header.content-type": ["text/javascript"],
					"http.resource.type": "script",
				}),
			);
	} finally {
		await closeServer(server);
	}
});

function startFixtureServer(): Promise<Server> {
	const server = createServer((request, response) => {
		if (request.url === "/") {
			response.writeHead(200, { "content-type": "text/html" });
			response.end('<body><script src="/assets/app-hash.js"></script></body>');
			return;
		}

		if (request.url === "/assets/app-hash.js") {
			response.writeHead(200, {
				"cache-control": "public, max-age=31536000, immutable",
				"content-type": "text/javascript",
			});
			response.end('document.body.dataset.script = "loaded";');
			return;
		}

		response.writeHead(404);
		response.end();
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

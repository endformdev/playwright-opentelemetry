import { createServer, type Server } from "node:http";
import { expect } from "@playwright/test";
import { test as base } from "../dist/fixture.mjs";

export const TEST_WORKER_FETCH_TRACE_TEST_NAME =
	"test worker fetch fixture trace";

const test = base.extend<{ fetchedInFixture: string }>({
	fetchedInFixture: [
		async ({ testTraceContext: _testTraceContext }, use) => {
			const server = await startFixtureServer();
			try {
				const address = server.address();
				if (!address || typeof address === "string") {
					throw new Error("Fixture server did not bind to a TCP port");
				}

				const response = await fetch(
					`http://127.0.0.1:${address.port}/fixture-fetch?source=test-worker`,
				);
				await use(await response.text());
			} finally {
				await closeServer(server);
			}
		},
		{ auto: true },
	],
});

test(TEST_WORKER_FETCH_TRACE_TEST_NAME, async ({ fetchedInFixture }) => {
	expect(fetchedInFixture).toBe("fixture fetch response");
});

function startFixtureServer(): Promise<Server> {
	const server = createServer((request, response) => {
		if (request.url?.startsWith("/fixture-fetch")) {
			response.writeHead(202, { "content-type": "text/plain" });
			response.end("fixture fetch response");
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

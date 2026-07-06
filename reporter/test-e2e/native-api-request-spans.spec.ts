import { createServer, type Server } from "node:http";
import { expect } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

export const NATIVE_API_REQUEST_TRACE_TEST_NAME =
	"native Playwright request fixture trace";

test(NATIVE_API_REQUEST_TRACE_TEST_NAME, async ({ request }) => {
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
		const postResponse = await request.post(
			`${baseUrl}/native-request?source=post`,
			{ data: { source: "playwright-request" } },
		);

		expect(getResponse.status()).toBe(203);
		expect(await getResponse.text()).toBe("native GET response");
		expect(postResponse.status()).toBe(201);
		expect(await postResponse.text()).toBe("native POST response");
	} finally {
		await closeServer(server);
	}
});

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

import { createServer, type Server } from "node:http";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test } from "../dist/fixture.mjs";

const PAGE_TEXT = "Span events fixture page";

test("browser console and page error span events", async ({
	page,
}: {
	page: Page;
}) => {
	// A local page, so the run doesn't depend on a third-party site's content.
	const server = await startPageServer();
	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Page server did not bind to a TCP port");
		}

		await page.goto(`http://127.0.0.1:${address.port}/`);
		const pageErrorPromise = page.waitForEvent("pageerror");
		await page.evaluate(async () => {
			const delay = (ms: number) =>
				new Promise((resolve) => setTimeout(resolve, ms));

			console.info("Browser span info event");
			await delay(100);
			console.warn("Browser span warning event");
			await delay(100);
			console.error("Browser span error event");
			await delay(100);
			setTimeout(() => {
				throw new Error("Browser span thrown error");
			}, 0);
		});
		await pageErrorPromise;

		await expect(page.locator("body")).toContainText(PAGE_TEXT);
	} finally {
		await closeServer(server);
	}
});

function startPageServer(): Promise<Server> {
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(
			`<!doctype html><title>Span events</title><p>${PAGE_TEXT}</p>`,
		);
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
		server.close((error) => (error ? reject(error) : resolve()));
		// The browser keeps its connection open; don't wait for it.
		server.closeAllConnections();
	});
}

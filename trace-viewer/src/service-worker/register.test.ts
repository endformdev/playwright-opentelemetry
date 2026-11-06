import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getServiceWorkerContainer,
	registerServiceWorker,
	unloadTraceFromServiceWorker,
} from "./register";

/** As in a sandboxed iframe without allow-same-origin */
function stubSandboxedNavigator() {
	vi.stubGlobal("navigator", {
		get serviceWorker() {
			throw new DOMException("sandboxed", "SecurityError");
		},
	});
}

describe("finding the service worker container", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns the container where there is one", () => {
		const container = {} as ServiceWorkerContainer;
		vi.stubGlobal("navigator", { serviceWorker: container });

		expect(getServiceWorkerContainer()).toBe(container);
	});

	it("returns null outside a secure context", () => {
		vi.stubGlobal("navigator", {});

		expect(getServiceWorkerContainer()).toBeNull();
	});

	it("returns null when reading it throws", () => {
		stubSandboxedNavigator();

		expect(getServiceWorkerContainer()).toBeNull();
	});

	it("fails registration clearly and unloads quietly when sandboxed", async () => {
		stubSandboxedNavigator();

		await expect(registerServiceWorker()).rejects.toThrow(
			"Service workers are not available in this page",
		);
		await expect(unloadTraceFromServiceWorker()).resolves.toBeUndefined();
	});
});

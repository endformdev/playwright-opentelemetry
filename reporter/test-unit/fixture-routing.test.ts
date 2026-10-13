import { test as base, type BrowserContext } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import type { PlaywrightOpentelemetryConfig } from "../src/shared/config";
import type { BrowserPageTracker } from "../src/fixture/browser-page-tracker";
import { createPlaywrightOtelTest } from "../src/fixture/playwright-opentelemetry-fixture";
import type { TestTraceContext } from "../src/fixture/trace-context";

type ContextFixture = (
	options: {
		context: BrowserContext;
		playwrightOpentelemetry: PlaywrightOpentelemetryConfig;
		testTraceContext: TestTraceContext;
		browserPageTracker: BrowserPageTracker;
	},
	use: (context: BrowserContext) => Promise<void>,
) => Promise<void>;

describe("browser context routing", () => {
	it.each([false, true, undefined])(
		"only installs the propagation route when enabled (propagateTraceHeaders: %s)",
		async (propagateTraceHeaders) => {
			const extend = vi.spyOn(base, "extend").mockReturnValue(base);
			let fixture: ContextFixture;
			try {
				createPlaywrightOtelTest(base);
				fixture = extend.mock.calls[0][0].context as unknown as ContextFixture;
			} finally {
				extend.mockRestore();
			}

			const context = {
				on: vi.fn(),
				off: vi.fn(),
				route: vi.fn(),
			};
			const use = vi.fn(async (providedContext) => {
				expect(providedContext).toBe(context);
				expect(context.on).toHaveBeenCalledWith(
					"request",
					expect.any(Function),
				);
				if (propagateTraceHeaders === false) {
					expect(context.route).not.toHaveBeenCalled();
				} else {
					expect(context.route).toHaveBeenCalledExactlyOnceWith(
						"**",
						expect.any(Function),
					);
				}
			});
			await fixture(
				{
					context: context as unknown as BrowserContext,
					playwrightOpentelemetry: { propagateTraceHeaders },
					testTraceContext: {} as TestTraceContext,
					browserPageTracker: {} as BrowserPageTracker,
				},
				use,
			);
			expect(use).toHaveBeenCalledOnce();
			expect(context.off).toHaveBeenCalledExactlyOnceWith(
				"request",
				context.on.mock.calls[0][1],
			);
		},
	);
});

import fs from "node:fs/promises";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import type { ResolvedPlaywrightOpentelemetryConfig } from "../shared/config";
import { filterRetainedDestinations } from "../shared/destinations";
import {
	couldRetainPlaywrightTrace,
	type PlaywrightTraceOption,
	shouldRetainPlaywrightTrace,
} from "../shared/playwright-trace";
import {
	createScreenshotsZip,
	SCREENSHOTS_ATTACHMENT_NAME,
} from "../shared/screenshots-zip";
import type { ScreencastCapture } from "./screencast-capture";

type ScreenshotsOptions = {
	trace: PlaywrightTraceOption | undefined;
	testInfo: Pick<TestInfo, "attach" | "expectedStatus" | "retry" | "status">;
};

/**
 * Screenshots only go to Trace API destinations and the local trace ZIP, so
 * there is no point capturing them when neither could keep this test.
 */
export function shouldCaptureScreenshots(
	config: ResolvedPlaywrightOpentelemetryConfig,
	options: ScreenshotsOptions,
): boolean {
	return (
		config.screenshots &&
		storesScreenshots(config, (trace) =>
			couldRetainPlaywrightTrace(trace ?? options.trace, options.testInfo),
		)
	);
}

/**
 * Stops the capture and, if the test is retained, attaches its frames as a
 * screenshots ZIP for the reporter to upload. Never rejects: a test must not
 * fail because its screenshots couldn't be stored.
 */
export async function attachScreenshots(
	capture: ScreencastCapture,
	config: ResolvedPlaywrightOpentelemetryConfig,
	options: ScreenshotsOptions,
): Promise<void> {
	try {
		const frames = await capture.stop();
		const retained = storesScreenshots(config, (trace) =>
			shouldRetainPlaywrightTrace(trace ?? options.trace, options.testInfo),
		);
		if (frames.length === 0 || !retained) {
			return;
		}

		const zip = await createScreenshotsZip(
			await Promise.all(
				frames.map(async (frame) => ({
					timestamp: frame.timestamp,
					file: frame.file,
					contentType: "image/jpeg",
					pageId: frame.pageId,
					blob: new Blob([await fs.readFile(frame.path)]),
				})),
			),
		);
		const zipPath = path.join(capture.dir, "screenshots.zip");
		await fs.writeFile(zipPath, Buffer.from(await zip.arrayBuffer()));
		await options.testInfo.attach(SCREENSHOTS_ATTACHMENT_NAME, {
			path: zipPath,
			contentType: "application/zip",
		});
	} catch (error) {
		console.warn(
			`Failed to store screenshots: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		await capture.dispose().catch(() => {});
	}
}

function storesScreenshots(
	config: ResolvedPlaywrightOpentelemetryConfig,
	retainsTrace: (trace: PlaywrightTraceOption | null) => boolean,
): boolean {
	return (
		(config.storeTraceZip && retainsTrace(config.trace)) ||
		filterRetainedDestinations(
			config.playwrightTraceApiDestinations,
			config.trace,
			retainsTrace,
		).length > 0
	);
}

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestInfo } from "@playwright/test";

/**
 * Shared by the two concurrent projects in playwright.live.config.ts. The
 * producer pauses at named checkpoints until the observer has checked what the
 * viewer shows, so every assertion happens at a known point mid-test.
 */

export const LIVE_TRACE_WORKER_URL = "http://localhost:9296";
export const LIVE_VIEWER_URL = "http://localhost:9394";

const CHECKPOINT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 100;

export function liveTraceViewerUrl(traceId: string): string {
	return viewerUrl(
		`${LIVE_TRACE_WORKER_URL}/playwright-otel-live/v1/${traceId}`,
	);
}

/** Where a finished test's static trace can be opened once the run ends. */
export function staticTraceViewerUrl(traceId: string): string {
	return viewerUrl(
		`${LIVE_TRACE_WORKER_URL}/playwright-otel-trace-viewer/v1/${traceId}`,
	);
}

function viewerUrl(traceSource: string): string {
	return `${LIVE_VIEWER_URL}/?traceSource=${encodeURIComponent(traceSource)}`;
}

/** The trace ID the playwright-opentelemetry fixture gave the current test. */
export function traceIdOf(testInfo: TestInfo): string {
	const attachment = testInfo.attachments.find(
		(candidate) => candidate.name === "playwright-opentelemetry-trace-context",
	);
	if (!attachment?.body) {
		throw new Error("The playwright-opentelemetry fixture didn't run");
	}
	return (JSON.parse(attachment.body.toString()) as { traceId: string })
		.traceId;
}

/** Producer: record reaching a checkpoint, then wait for the observer. */
export async function checkpoint(name: string, data = ""): Promise<void> {
	writeFileSync(file(`${name}.reached`), data);
	await waitFor(`${name}.released`, `the observer to release "${name}"`);
}

/** Observer: wait for the producer to reach a checkpoint; returns its data. */
export async function producerReached(name: string): Promise<string> {
	await waitFor(`${name}.reached`, `the producer to reach "${name}"`);
	return readFileSync(file(`${name}.reached`), "utf-8");
}

/** Observer: let the producer continue past a checkpoint. */
export function releaseProducer(name: string): void {
	writeFileSync(file(`${name}.released`), "");
}

/**
 * Marks a side as failed, so the other side stops waiting at once instead of
 * timing out.
 */
export function markFailed(side: "producer" | "observer"): void {
	writeFileSync(file(`${side}.failed`), "");
}

async function waitFor(name: string, what: string): Promise<void> {
	const deadline = Date.now() + CHECKPOINT_TIMEOUT_MS;
	while (!existsSync(file(name))) {
		for (const side of ["producer", "observer"]) {
			if (existsSync(file(`${side}.failed`))) {
				throw new Error(`Stopped waiting for ${what}: the ${side} failed`);
			}
		}
		if (Date.now() > deadline) {
			throw new Error(`Timed out waiting for ${what}`);
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
}

function file(name: string): string {
	const directory = process.env.LIVE_CHECKPOINT_DIR;
	if (!directory) {
		throw new Error(
			"LIVE_CHECKPOINT_DIR is set by the live config's global setup",
		);
	}
	return path.join(directory, name);
}

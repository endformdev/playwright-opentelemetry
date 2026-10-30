/**
 * Runs the live e2e suite: starts the viewer and the live trace Worker, runs
 * playwright.live.config.ts against them, then stops them.
 *
 * The servers run outside Playwright because Playwright stops its web servers
 * before reporters finish, and the playwright-opentelemetry reporter uploads
 * the observer's trace at the very end.
 *
 *   pnpm test:e2e:live               run the suite
 *   pnpm test:e2e:live --keep-open   keep the servers running afterwards, so the
 *                                    traces linked in the output stay viewable
 *
 * Other arguments are passed to `playwright test`.
 */
import { type ChildProcess, execSync, spawn } from "node:child_process";
import { LIVE_TRACE_WORKER_URL, LIVE_VIEWER_URL } from "./live-session";

const SERVER_START_TIMEOUT_MS = 60_000;

const args = process.argv.slice(2);
const keepOpen = args.includes("--keep-open");
const playwrightArgs = args.filter((arg) => arg !== "--keep-open");

const servers: ChildProcess[] = [];

process.on("SIGINT", () => stopServers(130));
process.on("SIGTERM", () => stopServers(143));

execSync("pnpm build", { stdio: "inherit" });
execSync("pnpm --filter @playwright-opentelemetry/trace-api build", {
	stdio: "inherit",
});

startServer("vite", ["preview", "--host", "localhost", "--port", "9394"]);
startServer("wrangler", [
	"dev",
	"-c",
	"test-e2e-live/live-trace-worker/wrangler.jsonc",
	"--port",
	"9296",
	"--persist-to",
	".wrangler/live-e2e-state",
]);

await Promise.all([
	waitForServer(LIVE_VIEWER_URL),
	waitForServer(`${LIVE_TRACE_WORKER_URL}/health`),
]);

const playwright = spawn(
	"pnpm",
	[
		"exec",
		"playwright",
		"test",
		"-c",
		"playwright.live.config.ts",
		...playwrightArgs,
	],
	{ stdio: "inherit" },
);
const exitCode = await new Promise<number>((resolve) =>
	playwright.on("exit", (code) => resolve(code ?? 1)),
);

if (keepOpen) {
	console.log(
		`\nThe viewer (${LIVE_VIEWER_URL}) and live trace Worker (${LIVE_TRACE_WORKER_URL}) are still running, so the trace links above open. Press Ctrl+C to stop them.`,
	);
} else {
	stopServers(exitCode);
}

function startServer(binary: string, commandArgs: string[]): void {
	// Its own process group, so stopping it also stops wrangler's workerd.
	const server = spawn(`node_modules/.bin/${binary}`, commandArgs, {
		detached: true,
		stdio: ["ignore", "ignore", "inherit"],
	});
	servers.push(server);
}

async function waitForServer(url: string): Promise<void> {
	const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			if ((await fetch(url)).ok) return;
		} catch {
			// Not up yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	console.error(`${url} didn't start within ${SERVER_START_TIMEOUT_MS} ms`);
	stopServers(1);
}

function stopServers(exitCode: number): never {
	for (const server of servers) {
		if (server.pid) {
			try {
				process.kill(-server.pid, "SIGTERM");
			} catch {
				// Already stopped.
			}
		}
	}
	process.exit(exitCode);
}

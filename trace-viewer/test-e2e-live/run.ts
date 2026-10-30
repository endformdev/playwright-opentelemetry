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
const SERVER_STOP_TIMEOUT_MS = 5000;

const args = process.argv.slice(2);
const keepOpen = args.includes("--keep-open");
const playwrightArgs = args.filter((arg) => arg !== "--keep-open");

const servers: ChildProcess[] = [];
let stopping: Promise<void> | undefined;

process.on("SIGINT", () => void stopServers(130));
process.on("SIGTERM", () => void stopServers(143));

// Tests against a server left over from another run would test old code.
for (const url of [LIVE_VIEWER_URL, `${LIVE_TRACE_WORKER_URL}/health`]) {
	if (await isUp(url)) {
		console.error(`${url} is already serving. Stop it first.`);
		process.exit(1);
	}
}

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
	await stopServers(exitCode);
}

function startServer(binary: string, commandArgs: string[]): void {
	// Its own process group, so stopping it also stops wrangler's workerd.
	const server = spawn(`node_modules/.bin/${binary}`, commandArgs, {
		detached: true,
		stdio: ["ignore", "ignore", "inherit"],
	});
	server.on("exit", (code, signal) => {
		if (!stopping) {
			console.error(
				`${binary} stopped unexpectedly (${signal ?? `exit code ${code}`})`,
			);
		}
	});
	servers.push(server);
}

async function isUp(url: string): Promise<boolean> {
	try {
		return (await fetch(url)).ok;
	} catch {
		return false;
	}
}

async function waitForServer(url: string): Promise<void> {
	const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await isUp(url)) return;
		await sleep(250);
	}
	console.error(`${url} didn't start within ${SERVER_START_TIMEOUT_MS} ms`);
	await stopServers(1);
}

async function stopServers(exitCode: number): Promise<never> {
	stopping ??= Promise.all(servers.map(stopServer)).then(() => {});
	await stopping;
	process.exit(exitCode);
}

/** Stops a server's whole process group, forcibly if it doesn't exit. */
async function stopServer(server: ChildProcess): Promise<void> {
	if (server.exitCode !== null || server.signalCode !== null) return;

	const exited = new Promise<void>((resolve) =>
		server.once("exit", () => resolve()),
	);
	signalGroup(server, "SIGTERM");
	const stopped = await Promise.race([
		exited.then(() => true),
		sleep(SERVER_STOP_TIMEOUT_MS).then(() => false),
	]);
	// wrangler's workerd shares the group and can outlive wrangler itself.
	signalGroup(server, stopped ? "SIGTERM" : "SIGKILL");
	if (!stopped) await exited;
}

function signalGroup(server: ChildProcess, signal: NodeJS.Signals): void {
	if (!server.pid) return;
	try {
		process.kill(-server.pid, signal);
	} catch {
		// The group is already gone.
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

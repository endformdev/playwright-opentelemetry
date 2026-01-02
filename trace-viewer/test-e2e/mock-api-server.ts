import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const PORT = 9295;

// In-memory trace storage - resets when server restarts
const traces = new Map<string, TraceData>();

interface TestInfo {
	name: string;
	describes: string[];
	file: string;
	line: number;
	status: "passed" | "failed" | "skipped" | "timedOut" | "interrupted";
	traceId: string;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
}

interface ScreenshotInfo {
	timestamp: number;
	file: string;
}

interface TraceData {
	testInfo: TestInfo;
	traces: Array<{ resourceSpans: unknown[] }>;
	screenshots: ScreenshotInfo[];
}

interface RegisterTraceRequest {
	testInfo: TestInfo;
	traces: Array<{ resourceSpans: unknown[] }>;
	screenshots?: ScreenshotInfo[];
}

function parseBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk.toString();
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	});
	res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, message: string, status = 404) {
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(JSON.stringify({ error: message }));
}

function sendCors(res: ServerResponse) {
	res.writeHead(204, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	});
	res.end();
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
	const url = new URL(req.url || "/", `http://localhost:${PORT}`);
	const pathParts = url.pathname.split("/").filter(Boolean);

	// Handle CORS preflight
	if (req.method === "OPTIONS") {
		sendCors(res);
		return;
	}

	// Health check endpoint for Playwright webServer
	if (url.pathname === "/health") {
		sendJson(res, { status: "ok" });
		return;
	}

	// Need at least a trace ID
	if (pathParts.length < 1) {
		sendError(res, "Missing trace ID", 400);
		return;
	}

	const traceId = pathParts[0];

	// POST /{traceId} - Register a new trace
	if (req.method === "POST" && pathParts.length === 1) {
		try {
			const body = await parseBody(req);
			const data: RegisterTraceRequest = JSON.parse(body);

			traces.set(traceId, {
				testInfo: data.testInfo,
				traces: data.traces,
				screenshots: data.screenshots || [],
			});

			sendJson(res, { success: true, traceId }, 201);
		} catch (err) {
			sendError(res, `Invalid JSON: ${err}`, 400);
		}
		return;
	}

	// All other routes require the trace to exist
	const traceData = traces.get(traceId);
	if (!traceData) {
		sendError(res, `Trace not found: ${traceId}`, 404);
		return;
	}

	// GET /{traceId}/test.json
	if (
		req.method === "GET" &&
		pathParts.length === 2 &&
		pathParts[1] === "test.json"
	) {
		sendJson(res, traceData.testInfo);
		return;
	}

	// GET /{traceId}/opentelemetry-protocol
	if (
		req.method === "GET" &&
		pathParts.length === 2 &&
		pathParts[1] === "opentelemetry-protocol"
	) {
		sendJson(res, { jsonFiles: ["playwright-opentelemetry.json"] });
		return;
	}

	// GET /{traceId}/opentelemetry-protocol/{file}
	if (
		req.method === "GET" &&
		pathParts.length === 3 &&
		pathParts[1] === "opentelemetry-protocol"
	) {
		const filename = pathParts[2];
		if (filename === "playwright-opentelemetry.json") {
			// Merge all resourceSpans from all trace exports
			const mergedResourceSpans: unknown[] = [];
			for (const trace of traceData.traces) {
				mergedResourceSpans.push(...trace.resourceSpans);
			}
			sendJson(res, { resourceSpans: mergedResourceSpans });
		} else {
			sendError(res, `Trace file not found: ${filename}`, 404);
		}
		return;
	}

	// GET /{traceId}/screenshots
	if (
		req.method === "GET" &&
		pathParts.length === 2 &&
		pathParts[1] === "screenshots"
	) {
		sendJson(res, { screenshots: traceData.screenshots });
		return;
	}

	// GET /{traceId}/screenshots/{file}
	if (
		req.method === "GET" &&
		pathParts.length === 3 &&
		pathParts[1] === "screenshots"
	) {
		const filename = pathParts[2];
		const screenshot = traceData.screenshots.find((s) => s.file === filename);

		if (!screenshot) {
			sendError(res, `Screenshot not found: ${filename}`, 404);
			return;
		}

		try {
			const filePath = join(FIXTURES_DIR, "screenshots", filename);
			const content = await readFile(filePath);

			res.writeHead(200, {
				"Content-Type": "image/jpeg",
				"Access-Control-Allow-Origin": "*",
			});
			res.end(content);
		} catch (err) {
			sendError(res, `Failed to read screenshot file: ${filename}`, 500);
		}
		return;
	}

	sendError(res, "Not found", 404);
}

const server = createServer(handleRequest);

server.listen(PORT, () => {
	console.log(`Mock API server listening on http://localhost:${PORT}`);
	console.log("Endpoints:");
	console.log("  POST /{traceId} - Register a trace");
	console.log("  GET /{traceId}/test.json");
	console.log("  GET /{traceId}/opentelemetry-protocol");
	console.log("  GET /{traceId}/opentelemetry-protocol/{file}");
	console.log("  GET /{traceId}/screenshots");
	console.log("  GET /{traceId}/screenshots/{file}");
	console.log("  GET /health - Health check");
});

#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist");

const DEFAULT_PORT = 9294;

const MIME_TYPES = {
	".html": "text/html; charset=UTF-8",
	".js": "application/javascript; charset=UTF-8",
	".css": "text/css; charset=UTF-8",
	".json": "application/json; charset=UTF-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

function parseArgs() {
	const args = process.argv.slice(2);
	let port = DEFAULT_PORT;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--port" && args[i + 1]) {
			const parsed = parseInt(args[i + 1], 10);
			if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
				port = parsed;
			} else {
				console.error(`Invalid port: ${args[i + 1]}`);
				process.exit(1);
			}
			i++;
		} else if (args[i] === "--help" || args[i] === "-h") {
			console.log(`
Playwright OpenTelemetry Trace Viewer

Usage: npx @playwright-opentelemetry/trace-viewer [options]

Options:
  --port <number>  Port to listen on (default: ${DEFAULT_PORT})
  --help, -h       Show this help message
`);
			process.exit(0);
		}
	}

	return { port };
}

async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function serveFile(filePath, res) {
	try {
		const content = await readFile(filePath);
		const ext = extname(filePath).toLowerCase();
		const contentType = MIME_TYPES[ext] || "application/octet-stream";

		const headers = {
			"Content-Type": contentType,
			"Cache-Control": "no-cache",
		};

		// Service worker needs special headers
		if (filePath.endsWith("sw.js")) {
			headers["Service-Worker-Allowed"] = "/";
		}

		res.writeHead(200, headers);
		res.end(content);
	} catch (err) {
		res.writeHead(500, { "Content-Type": "text/plain" });
		res.end("Internal Server Error");
	}
}

async function handleRequest(req, res) {
	const url = new URL(req.url, `http://${req.headers.host}`);
	let pathname = url.pathname;

	// Security: prevent directory traversal
	if (pathname.includes("..")) {
		res.writeHead(400, { "Content-Type": "text/plain" });
		res.end("Bad Request");
		return;
	}

	// Try to serve the exact file first
	let filePath = join(DIST_DIR, pathname);

	if (await fileExists(filePath)) {
		// Check if it's a directory, serve index.html from it
		const stats = await import("node:fs").then((fs) =>
			fs.promises.stat(filePath),
		);
		if (stats.isDirectory()) {
			filePath = join(filePath, "index.html");
			if (await fileExists(filePath)) {
				await serveFile(filePath, res);
				return;
			}
		} else {
			await serveFile(filePath, res);
			return;
		}
	}

	// SPA fallback: serve index.html for non-file routes
	const indexPath = join(DIST_DIR, "index.html");
	if (await fileExists(indexPath)) {
		await serveFile(indexPath, res);
		return;
	}

	res.writeHead(404, { "Content-Type": "text/plain" });
	res.end("Not Found");
}

async function openBrowser(url) {
	const { platform } = process;
	let command;

	switch (platform) {
		case "darwin":
			command = "open";
			break;
		case "win32":
			command = "start";
			break;
		default:
			command = "xdg-open";
	}

	try {
		const { exec } = await import("node:child_process");
		exec(`${command} ${url}`);
	} catch {
		// Silently fail if browser can't be opened
	}
}

async function main() {
	const { port } = parseArgs();

	// Check if dist directory exists
	if (!(await fileExists(DIST_DIR))) {
		console.error("Error: dist/ directory not found. Run 'pnpm build' first.");
		process.exit(1);
	}

	const server = createServer(handleRequest);

	server.listen(port, () => {
		const url = `http://localhost:${port}`;
		console.log(`
  Playwright OpenTelemetry Trace Viewer

  Local:   ${url}

  Press Ctrl+C to stop
`);
		openBrowser(url);
	});

	server.on("error", (err) => {
		if (err.code === "EADDRINUSE") {
			console.error(`Error: Port ${port} is already in use.`);
			console.error(`Try using a different port: --port <number>`);
		} else {
			console.error("Server error:", err.message);
		}
		process.exit(1);
	});
}

main();

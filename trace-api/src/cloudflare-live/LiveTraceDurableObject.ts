import type { OtlpExport, OtlpResourceSpans, OtlpScopeSpans } from "../otlp";

// The parts of the Durable Object runtime this class uses. Declared here so
// the package doesn't depend on Cloudflare's global types.
type SqlValue = ArrayBuffer | string | number | null;

interface SqlCursor<T> extends Iterable<T> {
	toArray(): T[];
	readonly rowsWritten: number;
}

interface SqlStorage {
	exec<T = Record<string, SqlValue>>(
		query: string,
		...bindings: unknown[]
	): SqlCursor<T>;
}

export interface LiveTraceDurableObjectState {
	readonly storage: {
		readonly sql: SqlStorage;
		setAlarm(scheduledTime: number): Promise<void>;
		deleteAlarm(): Promise<void>;
		deleteAll(): Promise<void>;
	};
}

export interface LiveTraceStarted {
	traceId: string;
	rootSpanId: string;
	test: {
		title: string;
		file: string;
		line: number;
		describes: string[];
		project: string;
	};
	/** Epoch milliseconds */
	startTime: number;
}

export interface LiveTraceEnded {
	status: string;
	/** Epoch milliseconds */
	endTime: number;
}

export interface LiveTraceSettings {
	/** How long the trace exists after it was created */
	retentionMs: number;
	/** How long after creation a trace without an end is marked abandoned */
	abandonAfterMs: number;
}

export const DEFAULT_LIVE_TRACE_SETTINGS: LiveTraceSettings = {
	retentionMs: 24 * 60 * 60 * 1000,
	abandonAfterMs: 2 * 60 * 60 * 1000,
};

/** Streams stay open this long after the end, so late spans still arrive. */
const STREAM_LINGER_AFTER_END_MS = 5 * 60 * 1000;
const STREAM_HEARTBEAT_MS = 15_000;
const STREAM_RETRY_MS = 1000;

type MetaKey =
	| "started"
	| "ended"
	| "expiresAt"
	| "abandonAt"
	| "closeStreamsAt";

const encoder = new TextEncoder();

/**
 * One live trace: an append-only event log in SQLite, streamed to viewers as
 * Server-Sent Events. Each event gets the next sequence number, which is also
 * its SSE id, so a reconnecting viewer resumes after the last one it saw.
 *
 * Storage is only created by a trusted write, so offering untrusted spans to
 * a trace that isn't live leaves no object behind.
 */
export class LiveTraceDurableObject {
	private readonly streams = new Set<WritableStreamDefaultWriter<Uint8Array>>();
	private heartbeat: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly ctx: LiveTraceDurableObjectState,
		_env: unknown,
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		switch (`${request.method} ${url.pathname}`) {
			case "PUT /start":
				return this.start(await readJson(request));
			case "POST /spans":
				return this.appendSpans(
					await readJson(request),
					url.searchParams.get("trusted") === "1",
				);
			case "POST /frames":
				return this.appendFrames(await readJson(request));
			case "PUT /end":
				return this.end(await readJson(request));
			case "GET /stream":
				return this.stream(request, url);
			case "GET /traces":
				return this.traces();
			default:
				return new Response("Not found", { status: 404 });
		}
	}

	async alarm(): Promise<void> {
		const now = Date.now();
		if (!this.isInitialized()) return;

		if (now >= this.getMeta<number>("expiresAt")!) {
			this.closeStreams();
			await this.ctx.storage.deleteAlarm();
			await this.ctx.storage.deleteAll();
			return;
		}

		if (!this.getMeta("ended") && now >= this.getMeta<number>("abandonAt")!) {
			this.recordEnd({ status: "abandoned", endTime: now });
		}

		const closeStreamsAt = this.getMeta<number>("closeStreamsAt");
		if (closeStreamsAt !== undefined && now >= closeStreamsAt) {
			this.closeStreams();
		}

		await this.scheduleAlarm();
	}

	private async start(body: {
		started: LiveTraceStarted;
		settings?: Partial<LiveTraceSettings>;
	}): Promise<Response> {
		await this.initialize({
			...DEFAULT_LIVE_TRACE_SETTINGS,
			...body.settings,
		});

		if (!this.getMeta("started")) {
			this.setMeta("started", body.started);
			this.appendEvent("trace.started", body.started);
		}

		return Response.json({ status: "ok" });
	}

	private async appendSpans(
		payload: OtlpExport,
		trusted: boolean,
	): Promise<Response> {
		if (!this.isInitialized()) {
			// Untrusted spans only join a trace that a producer already created.
			if (!trusted) return Response.json({ accepted: false });
			await this.initialize(DEFAULT_LIVE_TRACE_SETTINGS);
		}

		const resourceSpans: OtlpResourceSpans[] = [];
		for (const resourceSpan of payload.resourceSpans ?? []) {
			const scopeSpans: OtlpScopeSpans[] = [];
			for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
				const spans = (scopeSpan.spans ?? []).filter(
					(span) =>
						span.spanId &&
						this.sql.exec(
							"INSERT OR IGNORE INTO span_ids (span_id) VALUES (?)",
							span.spanId,
						).rowsWritten > 0,
				);
				if (spans.length > 0) scopeSpans.push({ ...scopeSpan, spans });
			}
			if (scopeSpans.length > 0) {
				resourceSpans.push({ ...resourceSpan, scopeSpans });
			}
		}

		if (resourceSpans.length > 0) {
			this.appendEvent("spans", { resourceSpans });
		}

		return Response.json({ accepted: true });
	}

	private appendFrames(body: { file: string }): Response {
		if (!this.isInitialized()) {
			return new Response("Live trace not found", { status: 404 });
		}

		this.appendEvent("frames", { file: body.file });
		return Response.json({ status: "ok" });
	}

	private async end(ended: LiveTraceEnded): Promise<Response> {
		if (!this.isInitialized()) {
			return new Response("Live trace not found", { status: 404 });
		}

		this.recordEnd(ended);
		await this.scheduleAlarm();
		return Response.json({ status: "ok" });
	}

	private recordEnd(ended: LiveTraceEnded): void {
		if (this.getMeta("ended")) return;

		this.setMeta("ended", ended);
		this.setMeta("closeStreamsAt", Date.now() + STREAM_LINGER_AFTER_END_MS);
		this.appendEvent("trace.ended", ended);
	}

	private stream(request: Request, url: URL): Response {
		if (!this.isInitialized()) {
			return new Response("Live trace not found", { status: 404 });
		}

		const after = parseOffset(
			request.headers.get("last-event-id") ?? url.searchParams.get("offset"),
		);
		const { readable, writable } = new TransformStream<
			Uint8Array,
			Uint8Array
		>();
		const writer = writable.getWriter();

		// Catch up and subscribe in one synchronous step, so no event slips
		// in between.
		this.write(writer, `retry: ${STREAM_RETRY_MS}\n\n`);
		for (const row of this.sql.exec<{
			seq: number;
			type: string;
			data: string;
		}>(
			"SELECT seq, type, data FROM events WHERE seq > ? ORDER BY seq",
			after,
		)) {
			this.write(writer, formatEvent(row.seq, row.type, row.data));
		}
		this.streams.add(writer);
		this.startHeartbeat();
		request.signal?.addEventListener("abort", () => this.dropStream(writer));

		return new Response(readable, {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
			},
		});
	}

	private traces(): Response {
		if (!this.isInitialized()) {
			return new Response("Live trace not found", { status: 404 });
		}

		const resourceSpans = this.sql
			.exec<{
				data: string;
			}>("SELECT data FROM events WHERE type = 'spans' ORDER BY seq")
			.toArray()
			.flatMap(
				(row) => (JSON.parse(row.data) as OtlpExport).resourceSpans ?? [],
			);

		return Response.json({ resourceSpans });
	}

	private get sql(): SqlStorage {
		return this.ctx.storage.sql;
	}

	private isInitialized(): boolean {
		return (
			this.sql
				.exec(
					"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
				)
				.toArray().length > 0
		);
	}

	private async initialize(settings: LiveTraceSettings): Promise<void> {
		if (this.isInitialized()) return;

		this.sql.exec(
			"CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, data TEXT NOT NULL)",
		);
		this.sql.exec("CREATE TABLE span_ids (span_id TEXT PRIMARY KEY)");
		this.sql.exec(
			"CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);

		const now = Date.now();
		this.setMeta("expiresAt", now + settings.retentionMs);
		this.setMeta("abandonAt", now + settings.abandonAfterMs);
		await this.scheduleAlarm();
	}

	private async scheduleAlarm(): Promise<void> {
		const deadlines = [
			this.getMeta<number>("expiresAt"),
			this.getMeta("ended") ? undefined : this.getMeta<number>("abandonAt"),
			this.getMeta<number>("closeStreamsAt"),
		].filter((deadline): deadline is number => deadline !== undefined);

		await this.ctx.storage.setAlarm(Math.min(...deadlines));
	}

	private appendEvent(type: string, data: unknown): void {
		const json = JSON.stringify(data);
		const [{ seq }] = this.sql
			.exec<{
				seq: number;
			}>(
				"INSERT INTO events (type, data) VALUES (?, ?) RETURNING seq",
				type,
				json,
			)
			.toArray();

		const message = formatEvent(seq, type, json);
		for (const writer of this.streams) {
			this.write(writer, message);
		}
	}

	private getMeta<T>(key: MetaKey): T | undefined {
		const [row] = this.sql
			.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
			.toArray();
		return row ? (JSON.parse(row.value) as T) : undefined;
	}

	private setMeta(key: MetaKey, value: unknown): void {
		this.sql.exec(
			"INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
			key,
			JSON.stringify(value),
		);
	}

	private write(
		writer: WritableStreamDefaultWriter<Uint8Array>,
		message: string,
	): void {
		writer.write(encoder.encode(message)).catch(() => this.dropStream(writer));
	}

	private startHeartbeat(): void {
		this.heartbeat ??= setInterval(() => {
			for (const writer of this.streams) {
				this.write(writer, ": ping\n\n");
			}
		}, STREAM_HEARTBEAT_MS);
	}

	private dropStream(writer: WritableStreamDefaultWriter<Uint8Array>): void {
		if (!this.streams.delete(writer)) return;

		writer.close().catch(() => {});
		if (this.streams.size === 0 && this.heartbeat) {
			clearInterval(this.heartbeat);
			this.heartbeat = undefined;
		}
	}

	private closeStreams(): void {
		for (const writer of this.streams) {
			this.dropStream(writer);
		}
	}
}

function formatEvent(seq: number, type: string, data: string): string {
	return `id: ${seq}\nevent: ${type}\ndata: ${data}\n\n`;
}

function readJson<T>(request: Request): Promise<T> {
	return request.json() as Promise<T>;
}

function parseOffset(value: string | null): number {
	const offset = Number(value);
	return Number.isInteger(offset) && offset > 0 ? offset : 0;
}

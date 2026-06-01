import type { APIRequestContext } from "@playwright/test";

const TRACE_API_URL = "http://localhost:9295";

/**
 * Span kind values as per OpenTelemetry spec
 */
export const SpanKind = {
	INTERNAL: 1,
	SERVER: 2,
	CLIENT: 3,
	PRODUCER: 4,
	CONSUMER: 5,
} as const;

type SpanKindType = (typeof SpanKind)[keyof typeof SpanKind];

interface Attribute {
	key: string;
	value: {
		stringValue?: string;
		intValue?: number;
		boolValue?: boolean;
		arrayValue?: { values: Array<{ stringValue: string }> };
	};
}

interface SpanData {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: SpanKindType;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes: Attribute[];
	status: { code: number };
	events: unknown[];
	links: unknown[];
}

interface ResourceSpan {
	serviceName: string;
	scopeName: string;
	scopeVersion: string;
	spans: SpanData[];
}

/**
 * Helper to generate unique trace IDs with a prefix
 */
export function generateTraceId(prefix: string): string {
	return `${prefix}`.padEnd(32, "0").slice(0, 32);
}

/**
 * Fluent builder for creating OTLP trace data for e2e tests.
 *
 * @example
 * ```ts
 * const builder = new TraceDataBuilder("mytest00000000000000000000000000", Date.now());
 *
 * builder
 *   .addTestSpan("My test name")
 *   .addStepSpan("Navigate to page")
 *   .addStepSpan("Fill form")
 *   .addHttpSpan("GET", "https://example.com/api")
 *   .addHttpSpan("POST", "https://api.example.com/auth")
 *   .addServerSpan("POST /api/auth")
 *   .addDbSpan("SELECT * FROM users", "postgresql");
 *
 * await builder.send(request);
 * ```
 */
export class TraceDataBuilder {
	private traceId: string;
	private startTime: number;
	private spanCounter = 0;
	private timeOffset = 0;
	private resourceSpans: Map<string, ResourceSpan> = new Map();
	private testSpanId: string | null = null;

	constructor(traceId: string, startTime: number) {
		this.traceId = traceId;
		this.startTime = startTime;
	}

	private nextSpanId(): string {
		this.spanCounter++;
		return `span${String(this.spanCounter).padStart(8, "0")}`;
	}

	private nextTimeRange(durationMs = 200): { start: string; end: string } {
		const start = this.startTime + this.timeOffset;
		this.timeOffset += durationMs + 50; // Add small gap between spans
		return {
			start: `${start}000000`,
			end: `${start + durationMs}000000`,
		};
	}

	private getOrCreateResourceSpan(
		serviceName: string,
		scopeName: string,
		scopeVersion = "1.0",
	): ResourceSpan {
		const key = `${serviceName}:${scopeName}`;
		if (!this.resourceSpans.has(key)) {
			this.resourceSpans.set(key, {
				serviceName,
				scopeName,
				scopeVersion,
				spans: [],
			});
		}
		return this.resourceSpans.get(key)!;
	}

	private addSpan(
		serviceName: string,
		scopeName: string,
		name: string,
		kind: SpanKindType,
		attributes: Attribute[],
		options: { parentSpanId?: string; durationMs?: number } = {},
	): string {
		const resource = this.getOrCreateResourceSpan(serviceName, scopeName);
		const spanId = this.nextSpanId();
		const time = this.nextTimeRange(options.durationMs);

		resource.spans.push({
			traceId: this.traceId,
			spanId,
			parentSpanId: options.parentSpanId,
			name,
			kind,
			startTimeUnixNano: time.start,
			endTimeUnixNano: time.end,
			attributes,
			status: { code: 1 },
			events: [],
			links: [],
		});

		return spanId;
	}

	/**
	 * Add a Playwright test span (root span for the test)
	 */
	addTestSpan(
		title: string,
		durationMs = 3000,
		metadata: {
			status?: "passed" | "failed" | "skipped";
			describes?: string[];
			file?: string;
			line?: number;
		} = {},
	): this {
		this.testSpanId = this.addSpan(
			"playwright-tests",
			"playwright",
			"playwright.test",
			SpanKind.INTERNAL,
			[
				{ key: "test.case.title", value: { stringValue: title } },
				{
					key: "playwright.test.status",
					value: { stringValue: metadata.status ?? "passed" },
				},
				{
					key: "playwright.test.describes",
					value: {
						arrayValue: {
							values: (metadata.describes ?? []).map((value) => ({
								stringValue: value,
							})),
						},
					},
				},
				{
					key: "code.file.path",
					value: { stringValue: metadata.file ?? "test.spec.ts" },
				},
				{ key: "code.line.number", value: { intValue: metadata.line ?? 1 } },
			],
			{ durationMs },
		);
		return this;
	}

	/**
	 * Add a Playwright test step span (child of test span)
	 */
	addStepSpan(title: string, durationMs = 400): this {
		this.addSpan(
			"playwright-tests",
			"playwright",
			"playwright.test.step",
			SpanKind.INTERNAL,
			[{ key: "test.step.title", value: { stringValue: title } }],
			{ parentSpanId: this.testSpanId ?? undefined, durationMs },
		);
		return this;
	}

	/**
	 * Add an HTTP client span (browser making a request)
	 */
	addHttpSpan(
		method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
		url: string,
		durationMs = 250,
	): this {
		const urlObj = new URL(url);
		this.addSpan(
			"playwright-browser",
			"playwright-browser",
			`HTTP ${method}`,
			SpanKind.CLIENT,
			[
				{ key: "http.request.method", value: { stringValue: method } },
				{ key: "server.address", value: { stringValue: urlObj.hostname } },
				{ key: "url.full", value: { stringValue: url } },
			],
			{ durationMs },
		);
		return this;
	}

	/**
	 * Add a server span (API receiving a request)
	 */
	addServerSpan(
		name: string,
		route?: string,
		serviceName = "api-service",
		durationMs = 300,
	): this {
		const attributes: Attribute[] = [];
		if (route) {
			attributes.push({ key: "http.route", value: { stringValue: route } });
		}
		this.addSpan(serviceName, "api", name, SpanKind.SERVER, attributes, {
			durationMs,
		});
		return this;
	}

	/**
	 * Add a database span
	 */
	addDbSpan(
		name: string,
		dbSystem: string,
		serviceName = "api-service",
		durationMs = 150,
	): this {
		this.addSpan(
			serviceName,
			"api",
			name,
			SpanKind.INTERNAL,
			[{ key: "db.system", value: { stringValue: dbSystem } }],
			{ durationMs },
		);
		return this;
	}

	/**
	 * Add a custom span with full control
	 */
	addCustomSpan(options: {
		serviceName: string;
		scopeName: string;
		name: string;
		kind: SpanKindType;
		attributes?: Record<string, string | number | boolean>;
		parentSpanId?: string;
		durationMs?: number;
	}): this {
		const attributes: Attribute[] = Object.entries(
			options.attributes ?? {},
		).map(([key, value]) => ({
			key,
			value:
				typeof value === "string"
					? { stringValue: value }
					: typeof value === "number"
						? { intValue: value }
						: { boolValue: value },
		}));

		this.addSpan(
			options.serviceName,
			options.scopeName,
			options.name,
			options.kind,
			attributes,
			{ parentSpanId: options.parentSpanId, durationMs: options.durationMs },
		);
		return this;
	}

	/**
	 * Build the OTLP resourceSpans array
	 */
	build(): { resourceSpans: unknown[] } {
		const resourceSpans = Array.from(this.resourceSpans.values()).map(
			(resource) => ({
				resource: {
					attributes: [
						{
							key: "service.name",
							value: { stringValue: resource.serviceName },
						},
					],
				},
				scopeSpans: [
					{
						scope: { name: resource.scopeName, version: resource.scopeVersion },
						spans: resource.spans,
					},
				],
			}),
		);

		return { resourceSpans };
	}

	/**
	 * Send the trace data to the trace API server
	 */
	async send(request: APIRequestContext): Promise<void> {
		await request.post(`${TRACE_API_URL}/v1/traces`, {
			data: this.build(),
		});
	}

	/**
	 * Get the trace ID for this builder
	 */
	getTraceId(): string {
		return this.traceId;
	}
}

/**
 * Helper to load a trace in the viewer
 */
export async function loadTrace(
	page: import("@playwright/test").Page,
	traceIdHex: string,
): Promise<void> {
	await page.goto("/");
	await page
		.getByPlaceholder("Enter API URL...")
		.fill(`${TRACE_API_URL}/playwright-otel-trace-viewer/${traceIdHex}`);
	await page.getByRole("button", { name: "Load" }).click();
}

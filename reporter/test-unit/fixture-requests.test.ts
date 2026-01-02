import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ATTR_TEST_STEP_CATEGORY,
	ATTR_TEST_STEP_NAME,
	ATTR_TEST_STEP_TITLE,
	TEST_SPAN_NAME,
	TEST_STEP_SPAN_NAME,
} from "../src/reporter/reporter-attributes";
import { runReporterTest } from "./reporter-harness";

// Mock the sender module
vi.mock("../src/reporter/sender", () => ({
	sendSpans: vi.fn(),
}));

// Import the mocked function
import { sendSpans } from "../src/reporter/sender";

/**
 * OpenTelemetry Semantic Conventions for HTTP Client Spans
 * @see https://opentelemetry.io/docs/specs/semconv/http/http-spans/
 */

// Span name follows HTTP client span convention: "HTTP {method}" or "{method}"
const HTTP_CLIENT_SPAN_NAME = "HTTP GET" as const;

// Required attributes for HTTP client spans
const ATTR_HTTP_REQUEST_METHOD = "http.request.method" as const;
const ATTR_SERVER_ADDRESS = "server.address" as const;
const ATTR_SERVER_PORT = "server.port" as const;
const ATTR_URL_FULL = "url.full" as const;
const ATTR_URL_PATH = "url.path" as const;
const ATTR_URL_QUERY = "url.query" as const;

// Conditionally required attributes
const ATTR_HTTP_RESPONSE_STATUS_CODE = "http.response.status_code" as const;
const ATTR_ERROR_TYPE = "error.type" as const;

// Resource type attribute for categorizing requests (similar to Chrome DevTools)
const ATTR_HTTP_RESOURCE_TYPE = "http.resource.type" as const;

// OpenTelemetry SpanKind values (from @opentelemetry/api)
// @see https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
const SPAN_KIND_CLIENT = 3;

// OpenTelemetry SpanStatusCode values (from @opentelemetry/api)
// @see https://opentelemetry.io/docs/specs/otel/trace/api/#set-status
const SPAN_STATUS_CODE_UNSET = 0;
const SPAN_STATUS_CODE_ERROR = 2;

describe("PlaywrightOpentelemetryReporter - Fixture Integration (HTTP Client Spans)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates an HTTP client span as child of step when fixture propagator is called", async () => {
		const networkStartTime = new Date("2025-11-06T10:00:00.200Z");
		const networkDuration = 150;
		const networkEndTime = new Date(
			networkStartTime.getTime() + networkDuration,
		);

		await runReporterTest({
			test: {
				title: "test with network request in step",
				titlePath: [
					"",
					"chromium",
					"network.spec.ts",
					"test with network request in step",
				],
				location: {
					file: "/Users/test/project/test-e2e/network.spec.ts",
					line: 5,
				},
			},
			result: {
				steps: [
					{
						title: "Navigate to page",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 500,
						location: {
							file: "/Users/test/project/test-e2e/network.spec.ts",
							line: 10,
						},
						networkActions: [
							{
								method: "GET",
								url: "https://api.example.com:443/users",
								serverAddress: "api.example.com",
								serverPort: 443,
								statusCode: 200,
								startTime: networkStartTime,
								duration: networkDuration,
							},
						],
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);

		// Should have test span, step span, and HTTP client span
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				// Test span
				expect.objectContaining({
					name: TEST_SPAN_NAME,
				}),
				// Step span
				expect.objectContaining({
					name: TEST_STEP_SPAN_NAME,
					attributes: expect.objectContaining({
						[ATTR_TEST_STEP_NAME]: "Navigate to page",
						[ATTR_TEST_STEP_TITLE]: "Navigate to page",
						[ATTR_TEST_STEP_CATEGORY]: "test.step",
					}),
				}),
				// HTTP client span - follows OpenTelemetry semantic conventions
				expect.objectContaining({
					name: HTTP_CLIENT_SPAN_NAME,
					kind: SPAN_KIND_CLIENT,
					// Timing comes directly from Playwright's timing() data
					startTime: networkStartTime,
					endTime: networkEndTime,
					// Span status MUST be left unset for 2xx responses
					status: { code: SPAN_STATUS_CODE_UNSET },
					attributes: expect.objectContaining({
						// Required attributes
						[ATTR_HTTP_REQUEST_METHOD]: "GET",
						[ATTR_SERVER_ADDRESS]: "api.example.com",
						[ATTR_SERVER_PORT]: 443,
						[ATTR_URL_FULL]: "https://api.example.com:443/users",
						// Conditionally required: status code if response received
						[ATTR_HTTP_RESPONSE_STATUS_CODE]: 200,
					}),
				}),
			]),
			expect.any(Object),
		);

		// Verify the HTTP client span has the step span as its parent
		const spans = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0][0];
		const stepSpan = spans.find(
			(s: { name: string }) => s.name === TEST_STEP_SPAN_NAME,
		);
		const httpSpan = spans.find(
			(s: { name: string }) => s.name === HTTP_CLIENT_SPAN_NAME,
		);

		expect(stepSpan).toBeDefined();
		expect(httpSpan).toBeDefined();
		expect(httpSpan.parentSpanId).toBe(stepSpan.spanId);

		// Verify browser network span has different service name
		expect(httpSpan.serviceName).toBe("playwright-browser");
		// Test/step spans should not have a serviceName (use default)
		expect(stepSpan.serviceName).toBeUndefined();
	});

	it("sets span status to Error for 4xx responses (CLIENT span kind)", async () => {
		const networkStartTime = new Date("2025-11-06T10:00:00.200Z");
		const networkDuration = 50;
		const networkEndTime = new Date(
			networkStartTime.getTime() + networkDuration,
		);

		await runReporterTest({
			test: {
				title: "test with 404 response",
				titlePath: [
					"",
					"chromium",
					"network.spec.ts",
					"test with 404 response",
				],
				location: {
					file: "/Users/test/project/test-e2e/network.spec.ts",
					line: 5,
				},
			},
			result: {
				steps: [
					{
						title: "Fetch missing resource",
						category: "test.step",
						startTime: new Date("2025-11-06T10:00:00.100Z"),
						duration: 500,
						networkActions: [
							{
								method: "GET",
								url: "https://api.example.com/missing",
								serverAddress: "api.example.com",
								serverPort: 443,
								statusCode: 404,
								startTime: networkStartTime,
								duration: networkDuration,
							},
						],
					},
				],
			},
		});

		expect(sendSpans).toHaveBeenCalledTimes(1);

		// For HTTP status codes in the 4xx range, span status SHOULD be set to Error
		// for SpanKind.CLIENT
		expect(sendSpans).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					name: "HTTP GET",
					kind: SPAN_KIND_CLIENT,
					// Timing comes directly from Playwright's timing() data
					startTime: networkStartTime,
					endTime: networkEndTime,
					status: { code: SPAN_STATUS_CODE_ERROR },
					attributes: expect.objectContaining({
						[ATTR_HTTP_REQUEST_METHOD]: "GET",
						[ATTR_HTTP_RESPONSE_STATUS_CODE]: 404,
						// error.type SHOULD be set to the status code number (as string)
						[ATTR_ERROR_TYPE]: "404",
					}),
				}),
			]),
			expect.any(Object),
		);
	});

	describe("url.path and url.query attributes", () => {
		it("includes url.path attribute for all requests", async () => {
			await runReporterTest({
				test: {
					title: "test with path",
					titlePath: ["", "chromium", "network.spec.ts", "test with path"],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Fetch API",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://api.example.com/users/123/profile",
									statusCode: 200,
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						attributes: expect.objectContaining({
							[ATTR_URL_FULL]: "https://api.example.com/users/123/profile",
							[ATTR_URL_PATH]: "/users/123/profile",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("includes url.query attribute when query string is present", async () => {
			await runReporterTest({
				test: {
					title: "test with query string",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with query string",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Search API",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://api.example.com/search?q=playwright&limit=10&page=1",
									statusCode: 200,
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						attributes: expect.objectContaining({
							[ATTR_URL_FULL]:
								"https://api.example.com/search?q=playwright&limit=10&page=1",
							[ATTR_URL_PATH]: "/search",
							[ATTR_URL_QUERY]: "q=playwright&limit=10&page=1",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("does not include url.query attribute when no query string", async () => {
			await runReporterTest({
				test: {
					title: "test without query string",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test without query string",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Fetch API",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://api.example.com/users",
									statusCode: 200,
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			const spans = (sendSpans as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const httpSpan = spans.find(
				(s: { name: string }) => s.name === "HTTP GET",
			);

			expect(httpSpan).toBeDefined();
			expect(httpSpan.attributes[ATTR_URL_PATH]).toBe("/users");
			expect(httpSpan.attributes[ATTR_URL_QUERY]).toBeUndefined();
		});
	});

	describe("http.resource.type attribute", () => {
		it("sets resource type to 'document' for HTML content-type", async () => {
			await runReporterTest({
				test: {
					title: "test with HTML document request",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with HTML document request",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Navigate to page",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/page",
									statusCode: 200,
									contentType: "text/html; charset=utf-8",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "document",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("sets resource type to 'script' for JavaScript content-type", async () => {
			await runReporterTest({
				test: {
					title: "test with JS request",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with JS request",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load script",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/app.js",
									statusCode: 200,
									contentType: "application/javascript",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "script",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("sets resource type to 'stylesheet' for CSS content-type", async () => {
			await runReporterTest({
				test: {
					title: "test with CSS request",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with CSS request",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load styles",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/styles.css",
									statusCode: 200,
									contentType: "text/css",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "stylesheet",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("sets resource type to 'image' for image content-types", async () => {
			await runReporterTest({
				test: {
					title: "test with image request",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with image request",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load image",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/logo.png",
									statusCode: 200,
									contentType: "image/png",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "image",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("sets resource type to 'font' for font content-types", async () => {
			await runReporterTest({
				test: {
					title: "test with font request",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with font request",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load font",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/font.woff2",
									statusCode: 200,
									contentType: "font/woff2",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "font",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("sets resource type to 'media' for video/audio content-types", async () => {
			await runReporterTest({
				test: {
					title: "test with media request",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with media request",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load video",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/video.mp4",
									statusCode: 200,
									contentType: "video/mp4",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "media",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("sets resource type to 'fetch' for JSON API responses", async () => {
			await runReporterTest({
				test: {
					title: "test with API request",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with API request",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Fetch API data",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://api.example.com/users",
									statusCode: 200,
									contentType: "application/json",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "fetch",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("falls back to URL extension when content-type is not available", async () => {
			await runReporterTest({
				test: {
					title: "test with no content-type",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with no content-type",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load script",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/bundle.js",
									statusCode: 200,
									// No contentType provided - should fall back to URL extension
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "script",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("falls back to URL extension for image when content-type is generic", async () => {
			await runReporterTest({
				test: {
					title: "test with octet-stream content-type",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with octet-stream content-type",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load image",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/photo.jpg",
									statusCode: 200,
									contentType: "application/octet-stream",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "image",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("sets resource type to 'other' when type cannot be determined", async () => {
			await runReporterTest({
				test: {
					title: "test with unknown content-type",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with unknown content-type",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load unknown",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/data",
									statusCode: 200,
									contentType: "application/x-custom-type",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "other",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("handles text/javascript content-type as script", async () => {
			await runReporterTest({
				test: {
					title: "test with text/javascript",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with text/javascript",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load script",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/app.js",
									statusCode: 200,
									contentType: "text/javascript",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "script",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("handles SVG images correctly", async () => {
			await runReporterTest({
				test: {
					title: "test with SVG image",
					titlePath: ["", "chromium", "network.spec.ts", "test with SVG image"],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load SVG",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/icon.svg",
									statusCode: 200,
									contentType: "image/svg+xml",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "image",
						}),
					}),
				]),
				expect.any(Object),
			);
		});

		it("handles WebAssembly modules", async () => {
			await runReporterTest({
				test: {
					title: "test with WASM request",
					titlePath: [
						"",
						"chromium",
						"network.spec.ts",
						"test with WASM request",
					],
					location: {
						file: "/Users/test/project/test-e2e/network.spec.ts",
						line: 5,
					},
				},
				result: {
					steps: [
						{
							title: "Load WASM",
							category: "test.step",
							startTime: new Date("2025-11-06T10:00:00.100Z"),
							duration: 500,
							networkActions: [
								{
									method: "GET",
									url: "https://example.com/module.wasm",
									statusCode: 200,
									contentType: "application/wasm",
									startTime: new Date("2025-11-06T10:00:00.200Z"),
									duration: 100,
								},
							],
						},
					],
				},
			});

			expect(sendSpans).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						name: "HTTP GET",
						kind: SPAN_KIND_CLIENT,
						attributes: expect.objectContaining({
							[ATTR_HTTP_RESOURCE_TYPE]: "script",
						}),
					}),
				]),
				expect.any(Object),
			);
		});
	});
});

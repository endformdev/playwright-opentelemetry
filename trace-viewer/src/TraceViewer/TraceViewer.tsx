import { createSignal, For, type JSX, Show } from "solid-js";
import type { TraceInfo } from "../traceInfoLoader";
import {
	flattenSpanTree,
	generateConnectors,
	type PackedSpan,
	packSpans,
	type SpanConnector,
} from "./packSpans";
import { ResizablePanel } from "./ResizablePanel";
import { ScreenshotFilmstrip } from "./ScreenshotFilmstrip";
import { TimelineRuler } from "./TimelineRuler";
import { TraceViewerHeader } from "./TraceViewerHeader";

export interface TraceViewerProps {
	traceInfo: TraceInfo;
}

export function TraceViewer(props: TraceViewerProps) {
	// Calculate duration from test info timestamps
	const durationMs = () =>
		calculateDurationMs(
			props.traceInfo.testInfo.startTimeUnixNano,
			props.traceInfo.testInfo.endTimeUnixNano,
		);

	// Shared hover position state (0-1 percentage, or null when not hovering)
	const [hoverPosition, setHoverPosition] = createSignal<number | null>(null);

	let mainPanelRef: HTMLDivElement | undefined;

	const handleMouseMove = (e: MouseEvent) => {
		if (!mainPanelRef) return;

		// Check if hovering over a resize handle (they have cursor-*-resize)
		const target = e.target as HTMLElement;
		const computedStyle = window.getComputedStyle(target);
		if (
			computedStyle.cursor === "col-resize" ||
			computedStyle.cursor === "row-resize"
		) {
			setHoverPosition(null);
			return;
		}

		const rect = mainPanelRef.getBoundingClientRect();
		const position = (e.clientX - rect.left) / rect.width;
		// Clamp to valid range
		if (position >= 0 && position <= 1) {
			setHoverPosition(position);
		} else {
			setHoverPosition(null);
		}
	};

	const handleMouseLeave = () => {
		setHoverPosition(null);
	};

	// Main Panel content (with fixed timeline ruler + vertical splits for Screenshot, Steps, Traces)
	const mainPanelContent = (
		// biome-ignore lint/a11y/noStaticElementInteractions: container needs mouse tracking for hover line
		<div
			ref={mainPanelRef}
			class="flex flex-col h-full relative"
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
		>
			{/* Fixed height timeline ruler at the top - no title */}
			<TimelineRuler durationMs={durationMs()} />

			{/* Remaining space for resizable panels */}
			<div class="flex-1 min-h-0">
				<ResizablePanel
					direction="vertical"
					initialFirstPanelSize={20}
					minFirstPanelSize={10}
					maxFirstPanelSize={40}
					firstPanel={
						<ScreenshotFilmstrip screenshots={props.traceInfo.screenshots} />
					}
					secondPanel={
						<ResizablePanel
							direction="vertical"
							initialFirstPanelSize={60}
							minFirstPanelSize={20}
							maxFirstPanelSize={80}
							firstPanel={<StepsTimeline traceInfo={props.traceInfo} />}
							secondPanel={<TracesPanel traceInfo={props.traceInfo} />}
						/>
					}
				/>
			</div>

			{/* Global hover line overlay - renders on top of everything */}
			<Show when={hoverPosition()} keyed>
				{(pos) => (
					<div
						class="absolute top-0 bottom-0 w-px bg-blue-500 pointer-events-none z-50"
						style={{ left: `${pos * 100}%` }}
					/>
				)}
			</Show>
		</div>
	);

	// Convert hover position (0-1) to time in milliseconds
	const hoverTimeMs = () => {
		const pos = hoverPosition();
		if (pos === null) return null;
		return pos * durationMs();
	};

	return (
		<div class="flex flex-col h-full w-full bg-white text-gray-900">
			<TraceViewerHeader
				testInfo={props.traceInfo.testInfo}
				hoverTimeMs={hoverTimeMs}
			/>

			{/* Resizable Main Content Area */}
			<div class="flex-1 min-h-0">
				<ResizablePanel
					direction="horizontal"
					initialFirstPanelSize={75}
					minFirstPanelSize={50}
					maxFirstPanelSize={90}
					firstPanel={mainPanelContent}
					secondPanel={<DetailsPanel traceInfo={props.traceInfo} />}
				/>
			</div>
		</div>
	);
}

// Dummy step data for demonstration
interface StepTreeItem {
	id: string;
	name: string;
	startOffset: number;
	duration: number;
	children: StepTreeItem[];
}

const dummyStepTree: StepTreeItem[] = [
	{
		id: "1",
		name: "Test: login flow",
		startOffset: 0,
		duration: 2500,
		children: [
			{
				id: "1.1",
				name: "navigate to login",
				startOffset: 50,
				duration: 800,
				children: [],
			},
			{
				id: "1.2",
				name: "fill credentials",
				startOffset: 900,
				duration: 1200,
				children: [
					{
						id: "1.2.1",
						name: "fill username",
						startOffset: 920,
						duration: 400,
						children: [],
					},
					{
						id: "1.2.2",
						name: "fill password",
						startOffset: 1350,
						duration: 350,
						children: [],
					},
				],
			},
			{
				id: "1.3",
				name: "click submit",
				startOffset: 2150,
				duration: 300,
				children: [],
			},
		],
	},
];

// Pre-compute packed steps for rendering
const flatSteps = flattenSpanTree(dummyStepTree);
const packedStepsResult = packSpans(flatSteps);

// Build a depth map to determine color based on nesting level
function buildDepthMap(
	spans: StepTreeItem[],
	depth = 0,
	map: Map<string, number> = new Map(),
): Map<string, number> {
	for (const span of spans) {
		map.set(span.id, depth);
		if (span.children.length > 0) {
			buildDepthMap(span.children, depth + 1, map);
		}
	}
	return map;
}

const stepDepthMap = buildDepthMap(dummyStepTree);

// Row height for steps timeline (same as traces for consistency)
const STEP_ROW_HEIGHT = 28;

function StepsTimeline(_props: { traceInfo: TraceInfo }) {
	const totalDuration = 2500; // Use dummy total for now

	const stepsConnectors = generateConnectors(
		packedStepsResult.spans,
		totalDuration,
	);

	const renderStep = (step: PackedSpan): JSX.Element => {
		const leftPercent = (step.startOffset / totalDuration) * 100;
		const widthPercent = (step.duration / totalDuration) * 100;
		const depth = stepDepthMap.get(step.id) ?? 0;

		return (
			<div
				class="absolute h-6 rounded text-xs flex items-center px-2 text-white truncate cursor-pointer hover:brightness-95"
				style={{
					left: `${leftPercent}%`,
					width: `${Math.max(widthPercent, 3)}%`,
					top: `${step.row * STEP_ROW_HEIGHT}px`,
					"background-color": `hsl(${210 + depth * 30}, 70%, ${55 + depth * 5}%)`,
				}}
				title={`${step.name} (${step.duration}ms)`}
			>
				{step.name}
			</div>
		);
	};

	const renderConnector = (connector: SpanConnector): JSX.Element => {
		const rowDiff = connector.childRow - connector.parentRow;
		const topPx = connector.parentRow * STEP_ROW_HEIGHT + 24;
		const heightPx = (rowDiff - 1) * STEP_ROW_HEIGHT + 4;

		return (
			<div
				class="absolute w-px bg-gray-400"
				style={{
					left: `${connector.xPercent}%`,
					top: `${topPx}px`,
					height: `${heightPx}px`,
				}}
			/>
		);
	};

	const containerHeight = packedStepsResult.totalRows * STEP_ROW_HEIGHT;

	return (
		<div class="h-full flex flex-col bg-gray-50">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Steps Timeline
			</div>
			<div class="flex-1 overflow-auto p-3">
				<div class="relative" style={{ height: `${containerHeight}px` }}>
					{/* Render connector lines first (behind spans) */}
					<For each={stepsConnectors}>
						{(connector) => renderConnector(connector)}
					</For>
					{/* Render steps on top */}
					<For each={packedStepsResult.spans}>{(step) => renderStep(step)}</For>
				</div>
			</div>
		</div>
	);
}

// Dummy span data for OpenTelemetry traces timeline
// These represent spans that are NOT part of the main test steps
// (e.g., HTTP requests, database queries, external service calls)
type SpanKind = "http" | "db" | "rpc" | "internal";

interface SpanTreeItem {
	id: string;
	name: string;
	startOffset: number; // ms from test start
	duration: number; // ms
	kind: SpanKind;
	children: SpanTreeItem[];
}

const dummySpanTree: SpanTreeItem[] = [
	{
		id: "s1",
		name: "HTTP GET /api/login",
		startOffset: 100,
		duration: 150,
		kind: "http",
		children: [
			{
				id: "s1.1",
				name: "DB SELECT users",
				startOffset: 110,
				duration: 45,
				kind: "db",
				children: [],
			},
			{
				id: "s1.2",
				name: "JWT sign",
				startOffset: 160,
				duration: 25,
				kind: "internal",
				children: [],
			},
		],
	},
	{
		id: "s2",
		name: "HTTP POST /api/session",
		startOffset: 950,
		duration: 200,
		kind: "http",
		children: [
			{
				id: "s2.1",
				name: "Redis SET session",
				startOffset: 970,
				duration: 30,
				kind: "db",
				children: [],
			},
			{
				id: "s2.2",
				name: "DB INSERT audit_log",
				startOffset: 1010,
				duration: 55,
				kind: "db",
				children: [],
			},
		],
	},
	{
		id: "s3",
		name: "HTTP GET /api/user/profile",
		startOffset: 1400,
		duration: 180,
		kind: "http",
		children: [
			{
				id: "s3.1",
				name: "DB SELECT user_profile",
				startOffset: 1420,
				duration: 60,
				kind: "db",
				children: [],
			},
			{
				id: "s3.2",
				name: "gRPC ProfileService.GetAvatar",
				startOffset: 1490,
				duration: 70,
				kind: "rpc",
				children: [
					{
						id: "s3.2.1",
						name: "S3 GetObject",
						startOffset: 1500,
						duration: 45,
						kind: "internal",
						children: [],
					},
				],
			},
		],
	},
	{
		id: "s4",
		name: "HTTP GET /api/dashboard",
		startOffset: 2000,
		duration: 350,
		kind: "http",
		children: [
			{
				id: "s4.1",
				name: "DB SELECT dashboard_config",
				startOffset: 2020,
				duration: 40,
				kind: "db",
				children: [],
			},
			{
				id: "s4.2",
				name: "gRPC AnalyticsService.GetMetrics",
				startOffset: 2080,
				duration: 180,
				kind: "rpc",
				children: [
					{
						id: "s4.2.1",
						name: "ClickHouse query",
						startOffset: 2100,
						duration: 120,
						kind: "db",
						children: [],
					},
				],
			},
			{
				id: "s4.3",
				name: "Redis GET cache:widgets",
				startOffset: 2280,
				duration: 25,
				kind: "db",
				children: [],
			},
		],
	},
];

// Build a lookup map for span kinds from the tree structure
function buildSpanKindMap(
	spans: SpanTreeItem[],
	map: Map<string, SpanKind> = new Map(),
): Map<string, SpanKind> {
	for (const span of spans) {
		map.set(span.id, span.kind);
		if (span.children.length > 0) {
			buildSpanKindMap(span.children, map);
		}
	}
	return map;
}

// Pre-compute packed spans and kind map for rendering
const spanKindMap = buildSpanKindMap(dummySpanTree);
const flatSpans = flattenSpanTree(dummySpanTree);
const packedResult = packSpans(flatSpans);

// Row height in pixels for the packed layout
const ROW_HEIGHT = 28;

function TracesPanel(_props: { traceInfo: TraceInfo }) {
	const totalDuration = 2500; // Use same dummy total as StepsTimeline for alignment

	// Color scheme for different span kinds
	const getSpanColor = (kind: SpanKind): string => {
		const baseColors = {
			http: { h: 200, s: 70, l: 50 }, // Blue for HTTP
			db: { h: 280, s: 60, l: 55 }, // Purple for DB
			rpc: { h: 160, s: 60, l: 45 }, // Teal for RPC
			internal: { h: 35, s: 70, l: 50 }, // Orange for internal
		};
		const base = baseColors[kind];
		return `hsl(${base.h}, ${base.s}%, ${base.l}%)`;
	};

	const connectors = generateConnectors(packedResult.spans, totalDuration);

	const renderSpan = (span: PackedSpan): JSX.Element => {
		const leftPercent = (span.startOffset / totalDuration) * 100;
		const widthPercent = (span.duration / totalDuration) * 100;
		const kind = spanKindMap.get(span.id) ?? "internal";

		return (
			<div
				class="absolute h-6 rounded text-xs flex items-center px-2 text-white truncate cursor-pointer hover:brightness-110"
				style={{
					left: `${leftPercent}%`,
					width: `${Math.max(widthPercent, 2)}%`,
					top: `${span.row * ROW_HEIGHT}px`,
					"background-color": getSpanColor(kind),
				}}
				title={`${span.name} (${span.duration}ms)`}
			>
				{span.name}
			</div>
		);
	};

	const renderConnector = (connector: SpanConnector): JSX.Element => {
		const rowDiff = connector.childRow - connector.parentRow;
		// Vertical line from bottom of parent row to top of child row
		const topPx = connector.parentRow * ROW_HEIGHT + 24; // Start just below parent span (24px = 6 row height)
		const heightPx = (rowDiff - 1) * ROW_HEIGHT + 4; // Connect to child span

		return (
			<div
				class="absolute w-px bg-gray-400"
				style={{
					left: `${connector.xPercent}%`,
					top: `${topPx}px`,
					height: `${heightPx}px`,
				}}
			/>
		);
	};

	const containerHeight = packedResult.totalRows * ROW_HEIGHT;

	return (
		<div class="h-full flex flex-col bg-gray-50">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Traces
			</div>
			<div class="flex-1 overflow-auto p-3">
				<div class="relative" style={{ height: `${containerHeight}px` }}>
					{/* Render connector lines first (behind spans) */}
					<For each={connectors}>
						{(connector) => renderConnector(connector)}
					</For>
					{/* Render spans on top */}
					<For each={packedResult.spans}>{(span) => renderSpan(span)}</For>
				</div>
			</div>
		</div>
	);
}

function DetailsPanel(_props: { traceInfo: TraceInfo }) {
	return (
		<div class="h-full flex flex-col bg-white">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Details
			</div>
			<div class="flex-1 overflow-auto p-3">
				<div class="text-gray-500 text-sm">
					<p class="mb-4">
						Select a step, screenshot, or trace to view details.
					</p>
					<div class="border border-gray-200 rounded p-3 bg-gray-50">
						<div class="text-xs text-gray-400 uppercase tracking-wide mb-2">
							Placeholder Content
						</div>
						<div class="space-y-2 text-xs">
							<div class="flex justify-between">
								<span class="text-gray-500">Type:</span>
								<span class="text-gray-700">—</span>
							</div>
							<div class="flex justify-between">
								<span class="text-gray-500">Duration:</span>
								<span class="text-gray-700">—</span>
							</div>
							<div class="flex justify-between">
								<span class="text-gray-500">Start Time:</span>
								<span class="text-gray-700">—</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * Calculates the test duration in milliseconds from nanosecond timestamps.
 */
function calculateDurationMs(
	startTimeUnixNano: string,
	endTimeUnixNano: string,
): number {
	const startNano = BigInt(startTimeUnixNano);
	const endNano = BigInt(endTimeUnixNano);
	const durationNano = endNano - startNano;
	// Convert nanoseconds to milliseconds
	return Number(durationNano / BigInt(1_000_000));
}

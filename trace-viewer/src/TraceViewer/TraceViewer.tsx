import { createSignal, For, type JSX } from "solid-js";
import type { TraceInfo } from "../traceInfoLoader";

// ============================================================================
// Resizable Panel Primitives
// ============================================================================

interface ResizablePanelProps {
	/** Direction of the split: 'horizontal' (left/right) or 'vertical' (top/bottom) */
	direction: "horizontal" | "vertical";
	/** Initial size of the first panel as a percentage (0-100) */
	initialFirstPanelSize?: number;
	/** Minimum size of the first panel as a percentage */
	minFirstPanelSize?: number;
	/** Maximum size of the first panel as a percentage */
	maxFirstPanelSize?: number;
	/** Content for the first panel */
	firstPanel: JSX.Element;
	/** Content for the second panel */
	secondPanel: JSX.Element;
	/** Additional class for the container */
	class?: string;
}

function ResizablePanel(props: ResizablePanelProps) {
	const initialSize = props.initialFirstPanelSize ?? 50;
	const minSize = props.minFirstPanelSize ?? 10;
	const maxSize = props.maxFirstPanelSize ?? 90;

	const [firstPanelSize, setFirstPanelSize] = createSignal(initialSize);
	const [isDragging, setIsDragging] = createSignal(false);

	let containerRef: HTMLDivElement | undefined;

	const handleMouseDown = (e: MouseEvent) => {
		e.preventDefault();
		setIsDragging(true);

		const handleMouseMove = (e: MouseEvent) => {
			if (!containerRef) return;

			const rect = containerRef.getBoundingClientRect();
			let newSize: number;

			if (props.direction === "horizontal") {
				newSize = ((e.clientX - rect.left) / rect.width) * 100;
			} else {
				newSize = ((e.clientY - rect.top) / rect.height) * 100;
			}

			// Clamp to min/max
			newSize = Math.max(minSize, Math.min(maxSize, newSize));
			setFirstPanelSize(newSize);
		};

		const handleMouseUp = () => {
			setIsDragging(false);
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		};

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);
	};

	const isHorizontal = () => props.direction === "horizontal";

	return (
		<div
			ref={containerRef}
			class={`flex ${isHorizontal() ? "flex-row" : "flex-col"} ${props.class ?? ""}`}
			style={{ height: "100%", width: "100%" }}
		>
			{/* First Panel */}
			<div
				style={{
					[isHorizontal() ? "width" : "height"]: `${firstPanelSize()}%`,
					"flex-shrink": 0,
					overflow: "hidden",
				}}
			>
				{props.firstPanel}
			</div>

			{/* Resize Handle */}
			{/* biome-ignore lint/a11y/useSemanticElements: resize handle requires custom drag interaction */}
			<div
				role="separator"
				aria-orientation={isHorizontal() ? "vertical" : "horizontal"}
				aria-valuenow={Math.round(firstPanelSize())}
				aria-valuemin={minSize}
				aria-valuemax={maxSize}
				tabIndex={0}
				class={`
					${isHorizontal() ? "w-1 cursor-col-resize hover:bg-blue-400/50" : "h-1 cursor-row-resize hover:bg-blue-400/50"}
					${isDragging() ? "bg-blue-500" : "bg-gray-300"}
					flex-shrink-0 transition-colors
				`}
				onMouseDown={handleMouseDown}
			/>

			{/* Second Panel */}
			<div
				style={{
					[isHorizontal() ? "width" : "height"]: `${100 - firstPanelSize()}%`,
					"flex-shrink": 0,
					overflow: "hidden",
				}}
			>
				{props.secondPanel}
			</div>
		</div>
	);
}

// ============================================================================
// Panel Components
// ============================================================================

interface TestHeaderProps {
	traceInfo: TraceInfo;
}

function TestHeader(props: TestHeaderProps) {
	const { testInfo } = props.traceInfo;

	const duration = () => {
		const startNano = BigInt(testInfo.startTimeUnixNano);
		const endNano = BigInt(testInfo.endTimeUnixNano);
		const durationMs = Number((endNano - startNano) / BigInt(1_000_000));
		return durationMs;
	};

	const statusColor = () => {
		switch (testInfo.status) {
			case "passed":
				return "text-green-600";
			case "failed":
				return "text-red-600";
			case "skipped":
				return "text-yellow-600";
			case "timedOut":
				return "text-orange-600";
			case "interrupted":
				return "text-orange-600";
			default:
				return "text-gray-500";
		}
	};

	const statusIcon = () => {
		switch (testInfo.status) {
			case "passed":
				return "✓";
			case "failed":
				return "✗";
			case "skipped":
				return "○";
			case "timedOut":
				return "⏱";
			case "interrupted":
				return "⚠";
			default:
				return "?";
		}
	};

	return (
		<div class="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-3">
			<div class="flex items-center gap-4">
				{/* Status Icon */}
				<span class={`text-xl ${statusColor()}`}>{statusIcon()}</span>

				{/* Test Name */}
				<div class="flex-1 min-w-0">
					<div class="flex items-baseline gap-2">
						{testInfo.describes.length > 0 && (
							<span class="text-gray-500 text-sm truncate">
								{testInfo.describes.join(" › ")}{" "}
								<span class="text-gray-400">›</span>
							</span>
						)}
						<span class="font-semibold text-gray-900 truncate">
							{testInfo.name}
						</span>
					</div>
					<div class="text-xs text-gray-500 font-mono truncate">
						{testInfo.file}:{testInfo.line}
					</div>
				</div>

				{/* Duration */}
				<div class="flex-shrink-0 text-right">
					<div class="text-sm font-mono text-gray-700">{duration()}ms</div>
					<div class={`text-xs ${statusColor()}`}>{testInfo.status}</div>
				</div>
			</div>
		</div>
	);
}

interface ScreenshotFilmstripProps {
	traceInfo: TraceInfo;
}

function ScreenshotFilmstrip(props: ScreenshotFilmstripProps) {
	const { screenshots } = props.traceInfo;

	return (
		<div class="h-full flex flex-col bg-gray-50">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Screenshots ({screenshots.length})
			</div>
			<div class="flex-1 overflow-x-auto overflow-y-hidden p-2">
				<div class="flex gap-2 h-full">
					{screenshots.length > 0 ? (
						<For each={screenshots}>
							{(screenshot) => (
								<div class="flex-shrink-0 h-full aspect-video bg-white rounded border border-gray-200 overflow-hidden shadow-sm">
									<img
										src={screenshot.url}
										alt={`Screenshot at ${screenshot.timestamp}`}
										class="w-full h-full object-contain"
									/>
								</div>
							)}
						</For>
					) : (
						<div class="flex items-center justify-center w-full text-gray-400 text-sm">
							No screenshots available
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// Dummy step data for demonstration
const dummySteps = [
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

interface StepItem {
	id: string;
	name: string;
	startOffset: number;
	duration: number;
	children: StepItem[];
}

function StepsTimeline(_props: { traceInfo: TraceInfo }) {
	const totalDuration = 2500; // Use dummy total for now

	const renderStep = (step: StepItem, depth: number): JSX.Element => {
		const leftPercent = (step.startOffset / totalDuration) * 100;
		const widthPercent = (step.duration / totalDuration) * 100;

		return (
			<div class="mb-1">
				<div
					class="relative h-6 rounded text-xs flex items-center px-2 text-white truncate cursor-pointer hover:brightness-95"
					style={{
						"margin-left": `${leftPercent}%`,
						width: `${Math.max(widthPercent, 5)}%`,
						"background-color": `hsl(${210 + depth * 30}, 70%, ${55 + depth * 5}%)`,
					}}
					title={`${step.name} (${step.duration}ms)`}
				>
					{step.name}
				</div>
				{step.children.length > 0 && (
					<div class="ml-4">
						<For each={step.children}>
							{(child) => renderStep(child, depth + 1)}
						</For>
					</div>
				)}
			</div>
		);
	};

	return (
		<div class="h-full flex flex-col bg-gray-50">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Steps Timeline
			</div>
			<div class="flex-1 overflow-auto p-3">
				<For each={dummySteps}>{(step) => renderStep(step, 0)}</For>
			</div>
		</div>
	);
}

// Dummy trace data for demonstration
const dummyTraces = [
	{
		id: "t1",
		type: "http" as const,
		method: "GET",
		url: "/api/login",
		status: 200,
		duration: 45,
	},
	{
		id: "t2",
		type: "http" as const,
		method: "POST",
		url: "/api/session",
		status: 201,
		duration: 120,
	},
	{
		id: "t3",
		type: "http" as const,
		method: "GET",
		url: "/api/user/profile",
		status: 200,
		duration: 85,
	},
	{
		id: "t4",
		type: "console" as const,
		level: "log",
		message: "User logged in successfully",
	},
	{
		id: "t5",
		type: "http" as const,
		method: "GET",
		url: "/api/dashboard",
		status: 200,
		duration: 230,
	},
];

function TracesPanel(_props: { traceInfo: TraceInfo }) {
	return (
		<div class="h-full flex flex-col bg-gray-50">
			<div class="flex-shrink-0 px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
				Traces
			</div>
			<div class="flex-1 overflow-auto">
				<For each={dummyTraces}>
					{(trace) => (
						<div class="px-3 py-2 border-b border-gray-100 hover:bg-gray-100 cursor-pointer text-sm">
							{trace.type === "http" ? (
								<div class="flex items-center gap-3">
									<span
										class={`font-mono font-semibold ${
											trace.method === "GET"
												? "text-green-600"
												: trace.method === "POST"
													? "text-blue-600"
													: trace.method === "PUT"
														? "text-yellow-600"
														: trace.method === "DELETE"
															? "text-red-600"
															: "text-gray-500"
										}`}
									>
										{trace.method}
									</span>
									<span class="flex-1 truncate text-gray-700 font-mono">
										{trace.url}
									</span>
									<span
										class={`font-mono ${
											trace.status >= 200 && trace.status < 300
												? "text-green-600"
												: trace.status >= 400
													? "text-red-600"
													: "text-yellow-600"
										}`}
									>
										{trace.status}
									</span>
									<span class="text-gray-400 font-mono">
										{trace.duration}ms
									</span>
								</div>
							) : (
								<div class="flex items-center gap-3">
									<span class="text-purple-600 font-mono">
										console.{trace.level}
									</span>
									<span class="flex-1 truncate text-gray-700">
										{trace.message}
									</span>
								</div>
							)}
						</div>
					)}
				</For>
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

// ============================================================================
// Main TraceViewer Component
// ============================================================================

export interface TraceViewerProps {
	traceInfo: TraceInfo;
}

export function TraceViewer(props: TraceViewerProps) {
	// Main Panel content (with vertical splits for Screenshot, Steps, Traces)
	const mainPanelContent = (
		<ResizablePanel
			direction="vertical"
			initialFirstPanelSize={20}
			minFirstPanelSize={10}
			maxFirstPanelSize={40}
			firstPanel={<ScreenshotFilmstrip traceInfo={props.traceInfo} />}
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
	);

	return (
		<div class="flex flex-col h-full w-full bg-white text-gray-900">
			{/* Fixed Test Header */}
			<TestHeader traceInfo={props.traceInfo} />

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

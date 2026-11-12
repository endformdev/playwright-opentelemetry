import { For, type JSX, Show } from "solid-js";
import {
	calculateInitialPanelSizes,
	PLAYER_BIG_SCREEN_SIZE_PERCENT,
} from "./panelSizing";
import { ComparisonScreens } from "./StepViewer";
import { type ViewerPanels, viewerSettingsFromPanels } from "./viewerPanels";
import { createViewerSettings } from "./viewerSettings";

/** How long one pulse of a skeleton takes; see the `skeleton` utility */
const SKELETON_PULSE_MS = 2000;

/**
 * Starts the pulse of the skeletons inside at the same point of its cycle as
 * any other skeleton on screen, by the wall clock. A page embedding the viewer
 * can do the same, so that its skeleton hands over to the viewer's without a
 * jump in the pulse.
 */
export function skeletonPhaseStyle(): JSX.CSSProperties {
	return { "--skeleton-delay": `${-(Date.now() % SKELETON_PULSE_MS)}ms` };
}

export interface TraceViewerSkeletonProps {
	/** The panels the viewer will show, e.g. from the URL */
	panels: ViewerPanels | null;
	/** The player's control bar will end with the embedding page's action */
	hasAction: boolean;
	/** For screen readers: what is loading */
	message: string;
	/** The caption of the trace to compare with, when the URL names one */
	comparisonLabel: string | null;
}

/**
 * The viewer's layout while the trace loads, with the same regions at the
 * same sizes as the viewer will show, so that the trace fills in where it
 * appears rather than moving the page. A page embedding the viewer can show
 * the same shapes before the viewer has loaded at all.
 */
export function TraceViewerSkeleton(props: TraceViewerSkeletonProps) {
	const settings = props.panels
		? viewerSettingsFromPanels(props.panels)
		: createViewerSettings().settings();
	const showHeader = props.panels?.header ?? true;
	const showRuler = props.panels?.ruler ?? true;
	const showDetails = props.panels?.details ?? true;
	const spanPanels = (["steps", "browser", "external"] as const).filter(
		(id) => settings[id],
	);
	const showMainColumn =
		settings.stepViewer || showRuler || spanPanels.length > 0;
	const spanPanelSizes = calculateInitialPanelSizes({
		steps: spanPanels.includes("steps"),
		browser: spanPanels.includes("browser"),
		external: spanPanels.includes("external"),
	});

	const spansColumn = () => (
		<div class="flex h-full flex-col">
			<Show when={!settings.stepViewer && showRuler}>
				<RulerSkeleton />
			</Show>
			<div class="flex min-h-0 flex-1 flex-col">
				<For each={spanPanels}>
					{(id, index) => (
						<>
							<Show when={index() > 0}>
								<SplitHandle direction="vertical" />
							</Show>
							<div
								class="min-h-0 overflow-hidden"
								style={{ flex: `${spanPanelSizes[id] ?? 0} 1 0px` }}
							>
								<SpanPanelSkeleton panel={id} />
							</div>
						</>
					)}
				</For>
			</div>
		</div>
	);

	const player = () => (
		<div class="flex h-full flex-col bg-white">
			<div class="relative min-h-0 flex-1 bg-gray-100 p-3">
				<Show when={props.comparisonLabel} fallback={<ScreenshotSkeleton />}>
					{(label) => (
						<ComparisonScreens
							comparison={{
								label: label(),
								status: "loading",
								testStatus: null,
								frame: { timeMs: null, screenshot: null },
								noScreenshots: false,
								note: null,
							}}
							testStatus={null}
							primaryScreen={() => <ScreenshotSkeleton />}
						/>
					)}
				</Show>
			</div>
			<ControlBarSkeleton hasAction={props.hasAction} />
			<Show when={showRuler}>
				<RulerSkeleton />
			</Show>
		</div>
	);

	const mainColumn = () => (
		<Show when={settings.stepViewer} fallback={spansColumn()}>
			<Show when={spanPanels.length > 0} fallback={player()}>
				<div class="flex h-full flex-col">
					<div
						class="flex-shrink-0 overflow-hidden"
						style={{ height: `${PLAYER_BIG_SCREEN_SIZE_PERCENT}%` }}
					>
						{player()}
					</div>
					<SplitHandle direction="vertical" />
					<div class="min-h-0 flex-1 overflow-hidden">{spansColumn()}</div>
				</div>
			</Show>
		</Show>
	);

	return (
		<div
			role="status"
			aria-label="Loading trace"
			data-testid="trace-viewer-skeleton"
			class="flex h-full w-full flex-col bg-white"
			style={skeletonPhaseStyle()}
		>
			<span class="sr-only">{props.message}</span>
			<Show when={showHeader}>
				<HeaderSkeleton />
			</Show>
			<div class="flex min-h-0 flex-1" aria-hidden="true">
				<Show when={showMainColumn}>
					<div
						class="min-w-0 flex-shrink-0 overflow-hidden"
						style={{ width: showDetails ? "75%" : "100%" }}
					>
						{mainColumn()}
					</div>
				</Show>
				<Show when={showMainColumn && showDetails}>
					<SplitHandle direction="horizontal" />
				</Show>
				<Show when={showDetails}>
					<div class="min-w-0 flex-1 overflow-hidden">
						<DetailsSkeleton />
					</div>
				</Show>
			</div>
		</div>
	);
}

/**
 * Where the step viewer's screenshot will be: a 16:9 frame, as large as fits.
 * The step viewer shows it too while its screenshots load.
 */
export function ScreenshotSkeleton() {
	return (
		<div
			class="flex h-full w-full items-center justify-center"
			style={{ "container-type": "size" }}
			data-testid="screenshot-skeleton"
		>
			<div
				class="skeleton aspect-video bg-gray-200"
				style={{ width: "min(100cqw, 100cqh * 16 / 9)" }}
			/>
		</div>
	);
}

/** The resize handle between two regions, drawn as the viewer's are */
function SplitHandle(props: { direction: "horizontal" | "vertical" }) {
	return (
		<div
			class="flex-shrink-0 bg-gray-200 bg-clip-content"
			classList={{
				"w-1 px-[1.5px]": props.direction === "horizontal",
				"h-1 py-[1.5px]": props.direction === "vertical",
			}}
		/>
	);
}

function HeaderSkeleton() {
	return (
		<div
			class="flex-shrink-0 border-b border-gray-200 bg-white px-4 py-3"
			aria-hidden="true"
		>
			<div class="flex items-center gap-4">
				<div class="skeleton h-6 w-20 rounded-full" />
				<div class="min-w-0 flex-1">
					<div class="flex h-6 items-center">
						<div class="skeleton h-4 w-64 max-w-full" />
					</div>
					<div class="flex h-4 items-center">
						<div class="skeleton h-3 w-40 max-w-full" />
					</div>
				</div>
				<div class="skeleton h-8 w-8 rounded-full" />
				<div class="skeleton h-9 w-80 rounded-md" />
				<div class="flex min-w-[140px] flex-shrink-0 flex-col items-end gap-1.5">
					<div class="skeleton h-3.5 w-12" />
					<div class="skeleton h-3 w-24" />
				</div>
				<div class="skeleton h-8 w-8 rounded-md" />
			</div>
		</div>
	);
}

/** The player's control bar: transport, speed, step and the embedder's action */
function ControlBarSkeleton(props: { hasAction: boolean }) {
	return (
		<div class="flex h-12 flex-shrink-0 items-center gap-3 border-t border-gray-200 bg-white px-3">
			<div class="flex flex-shrink-0 items-center gap-0.5">
				<div class="skeleton h-8 w-8 rounded-md" />
				<div class="skeleton h-8 w-8 rounded-md" />
				<div class="skeleton h-8 w-8 rounded-md" />
				<div class="skeleton ml-0.5 h-7 w-9 rounded-md" />
			</div>
			<div class="skeleton h-3 w-10 flex-shrink-0" />
			<div class="min-w-0 flex-1">
				<div class="skeleton h-3.5 w-56 max-w-full" />
			</div>
			<Show when={props.hasAction}>
				<div class="skeleton h-8 w-8 flex-shrink-0 rounded-md" />
			</Show>
		</div>
	);
}

/** The step ruler: its track, then its time ticks */
function RulerSkeleton() {
	return (
		<div class="relative flex-shrink-0 border-b border-gray-200 bg-white">
			<div class="relative mx-3 h-[52px]">
				<div class="skeleton absolute inset-x-0 top-2 h-3 rounded-[3px]" />
				<div class="absolute inset-x-0 top-8 flex justify-between">
					<For each={Array.from({ length: 8 })}>
						{() => <div class="skeleton h-2.5 w-8" />}
					</For>
				</div>
			</div>
		</div>
	);
}

/** Bars in a span panel, as left and width in percent of the plot, per row */
const SPAN_PANEL_BARS: Record<
	"steps" | "browser" | "external",
	[left: number, width: number][][]
> = {
	steps: [
		[[0, 100]],
		[
			[3, 14],
			[22, 30],
			[58, 36],
		],
		[
			[24, 12],
			[60, 18],
		],
	],
	browser: [
		[
			[2, 9],
			[20, 6],
			[41, 12],
			[66, 7],
		],
		[
			[5, 4],
			[23, 15],
			[57, 10],
		],
		[
			[12, 6],
			[44, 5],
			[78, 9],
		],
	],
	external: [
		[
			[18, 10],
			[61, 14],
		],
		[[22, 5]],
	],
};

/** A span timeline panel, with a few bars in place of its spans */
function SpanPanelSkeleton(props: { panel: "steps" | "browser" | "external" }) {
	return (
		<div class="relative h-full overflow-hidden bg-gray-50 py-3">
			<For each={SPAN_PANEL_BARS[props.panel]}>
				{(bars) => (
					<div class="relative mx-3 h-7">
						<For each={bars}>
							{([left, width]) => (
								<div
									class="skeleton absolute inset-y-0.5 rounded-xs bg-gray-200"
									style={{ left: `${left}%`, width: `${width}%` }}
								/>
							)}
						</For>
					</div>
				)}
			</For>
		</div>
	);
}

/** The details sidebar: a screenshot, then a list of steps */
function DetailsSkeleton() {
	return (
		<div class="h-full space-y-6 bg-white p-4">
			<div class="skeleton aspect-video w-full rounded-md" />
			<div>
				<div class="skeleton mb-3 h-2.5 w-16" />
				<div class="space-y-2">
					<div class="skeleton h-9 w-full rounded-md" />
					<div class="skeleton h-9 w-4/5 rounded-md" />
				</div>
			</div>
		</div>
	);
}

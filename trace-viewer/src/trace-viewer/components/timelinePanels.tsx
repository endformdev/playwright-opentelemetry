import { type Accessor, createMemo, type JSX } from "solid-js";
import type {
	Span,
	SpanEvent,
	SpanKind,
} from "../../trace-data-loader/exportToSpans";
import type { FocusedElementType } from "../contexts/HoverContext";
import {
	getResourceColor,
	getResourceDisplayName,
	getResourceIcon,
	getResourceType,
} from "./browserSpanStyles";
import { getStepTimelineColor } from "./stepSpanStyles";

export type TimelinePanelId = "steps" | "browser" | "external";

/** How one bar is drawn, apart from the error colour every panel shares. */
export interface BarAppearance {
	name: string;
	color: string;
	icon?: JSX.Element;
	events?: SpanEvent[];
}

export interface TimelineSpanSources {
	steps: Accessor<Span[]>;
	browserSpans: Accessor<Span[]>;
	externalSpans: Accessor<Span[]>;
}

export interface TimelinePanelDefinition {
	id: TimelinePanelId;
	title: string;
	/** Shown on the panel's footer header when it has no spans */
	emptyTooltip: string;
	/** What hovering or focusing one of the panel's bars points at */
	elementType: Exclude<FocusedElementType, "screenshot">;
	spans: (sources: TimelineSpanSources) => Span[];
	/**
	 * Creates the panel's bar styling from all its spans. Called once per
	 * mounted panel, so it may set up memos.
	 */
	createAppearance: (spans: Accessor<Span[]>) => (span: Span) => BarAppearance;
}

function buildDepthMap(spans: Span[]): Map<string, number> {
	const depthMap = new Map<string, number>();
	const spanMap = new Map(spans.map((span) => [span.id, span]));

	const getDepth = (span: Span): number => {
		const known = depthMap.get(span.id);
		if (known !== undefined) return known;
		const parent =
			span.parentId === null ? undefined : spanMap.get(span.parentId);
		const depth = parent ? getDepth(parent) + 1 : 0;
		depthMap.set(span.id, depth);
		return depth;
	};

	for (const span of spans) {
		getDepth(span);
	}
	return depthMap;
}

const SPAN_KIND_COLORS: Record<SpanKind, string> = {
	server: "hsl(200, 70%, 50%)", // Blue
	client: "hsl(280, 60%, 55%)", // Purple
	producer: "hsl(160, 60%, 45%)", // Teal
	consumer: "hsl(35, 70%, 50%)", // Orange
	internal: "hsl(100, 50%, 45%)", // Green
};

/** The span panels, top to bottom. Rendering, sizing and navigation follow this order. */
export const TIMELINE_PANELS: TimelinePanelDefinition[] = [
	{
		id: "steps",
		title: "Steps Timeline",
		emptyTooltip: "No test steps were recorded",
		elementType: "step",
		spans: (sources) => sources.steps(),
		createAppearance: (spans) => {
			const depths = createMemo(() => buildDepthMap(spans()));
			return (span) => ({
				name: span.title,
				color: getStepTimelineColor(span, depths().get(span.id) ?? 0),
			});
		},
	},
	{
		id: "browser",
		title: "Browser Spans",
		emptyTooltip: "No browser spans were captured",
		elementType: "span",
		spans: (sources) => sources.browserSpans(),
		createAppearance: () => (span) => {
			const resourceType = getResourceType(span);
			return {
				name: getResourceDisplayName(span),
				color: getResourceColor(resourceType),
				icon: getResourceIcon(resourceType),
				events: span.events,
			};
		},
	},
	{
		id: "external",
		title: "External Spans",
		emptyTooltip: "No external spans were captured",
		elementType: "span",
		spans: (sources) => sources.externalSpans(),
		createAppearance: () => (span) => ({
			name: span.title,
			color: SPAN_KIND_COLORS[span.kind],
			events: span.events,
		}),
	},
];

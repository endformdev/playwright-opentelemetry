import { createSignal, For, type JSX } from "solid-js";

export interface PanelConfig {
	/** Unique identifier for the panel */
	id: string;
	/** Initial size as a percentage (0-100). All panels should sum to 100 */
	initialSize: number;
	/** Minimum size as a percentage */
	minSize?: number;
	/** Content to render in this panel */
	content: JSX.Element;
}

export interface MultiResizablePanelProps {
	/** Direction of the split: 'horizontal' (left/right) or 'vertical' (top/bottom) */
	direction: "horizontal" | "vertical";
	/** Array of panel configurations */
	panels: PanelConfig[];
	/** Additional class for the container */
	class?: string;
}

/**
 * A resizable panel component that supports N panels with drag handles between each.
 * This extends the concept of ResizablePanel to work with any number of sections.
 */
export function MultiResizablePanel(props: MultiResizablePanelProps) {
	// Track sizes for each panel by ID
	const initialSizes = () => {
		const sizes: Record<string, number> = {};
		for (const panel of props.panels) {
			sizes[panel.id] = panel.initialSize;
		}
		return sizes;
	};

	const [panelSizes, setPanelSizes] = createSignal(initialSizes());
	const [draggingIndex, setDraggingIndex] = createSignal<number | null>(null);

	let containerRef: HTMLDivElement | undefined;

	const isHorizontal = () => props.direction === "horizontal";

	const handleMouseDown = (handleIndex: number) => (e: MouseEvent) => {
		e.preventDefault();
		setDraggingIndex(handleIndex);

		const handleMouseMove = (e: MouseEvent) => {
			if (!containerRef) return;

			const rect = containerRef.getBoundingClientRect();
			const totalSize = isHorizontal() ? rect.width : rect.height;
			const mousePos = isHorizontal()
				? e.clientX - rect.left
				: e.clientY - rect.top;
			const mousePercent = (mousePos / totalSize) * 100;

			setPanelSizes((prev) => {
				const panels = props.panels;
				const newSizes = { ...prev };

				// Calculate the position before the handle (sum of all panels before handleIndex + 1)
				let positionBefore = 0;
				for (let i = 0; i <= handleIndex; i++) {
					positionBefore += prev[panels[i].id];
				}

				// Calculate the position after the handle
				let positionAfter = 0;
				for (let i = 0; i <= handleIndex + 1; i++) {
					positionAfter += prev[panels[i].id];
				}

				// Calculate delta from the current handle position
				const currentHandlePos = positionBefore;
				const delta = mousePercent - currentHandlePos;

				// Get min sizes for the panels being resized
				const panelBefore = panels[handleIndex];
				const panelAfter = panels[handleIndex + 1];
				const minBefore = panelBefore.minSize ?? 5;
				const minAfter = panelAfter.minSize ?? 5;

				// Calculate new sizes
				let newSizeBefore = prev[panelBefore.id] + delta;
				let newSizeAfter = prev[panelAfter.id] - delta;

				// Enforce minimums
				if (newSizeBefore < minBefore) {
					newSizeAfter -= minBefore - newSizeBefore;
					newSizeBefore = minBefore;
				}
				if (newSizeAfter < minAfter) {
					newSizeBefore -= minAfter - newSizeAfter;
					newSizeAfter = minAfter;
				}

				// Final clamp
				newSizeBefore = Math.max(minBefore, newSizeBefore);
				newSizeAfter = Math.max(minAfter, newSizeAfter);

				newSizes[panelBefore.id] = newSizeBefore;
				newSizes[panelAfter.id] = newSizeAfter;

				return newSizes;
			});
		};

		const handleMouseUp = () => {
			setDraggingIndex(null);
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		};

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);
	};

	return (
		<div
			ref={containerRef}
			class={`flex ${isHorizontal() ? "flex-row" : "flex-col"} ${props.class ?? ""}`}
			style={{ height: "100%", width: "100%" }}
		>
			<For each={props.panels}>
				{(panel, index) => (
					<>
						{/* Panel content */}
						<div
							style={{
								[isHorizontal() ? "width" : "height"]:
									`${panelSizes()[panel.id]}%`,
								"flex-shrink": 0,
								overflow: "hidden",
							}}
						>
							{panel.content}
						</div>

						{/* Resize handle (between panels, not after the last one) */}
						{index() < props.panels.length - 1 && (
							// biome-ignore lint/a11y/useSemanticElements: resize handle requires custom drag interaction
							<div
								role="separator"
								aria-orientation={isHorizontal() ? "vertical" : "horizontal"}
								aria-valuenow={Math.round(panelSizes()[panel.id])}
								tabIndex={0}
								class={`
									${isHorizontal() ? "w-1 cursor-col-resize hover:bg-blue-400/50" : "h-1 cursor-row-resize hover:bg-blue-400/50"}
									${draggingIndex() === index() ? "bg-blue-500" : "bg-gray-300"}
									flex-shrink-0 transition-colors
								`}
								onMouseDown={handleMouseDown(index())}
							/>
						)}
					</>
				)}
			</For>
		</div>
	);
}

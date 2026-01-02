import { createSignal, type JSX } from "solid-js";

export interface ResizablePanelProps {
	direction: "horizontal" | "vertical";
	initialFirstPanelSize?: number;
	minFirstPanelSize?: number;
	maxFirstPanelSize?: number;
	firstPanel: JSX.Element;
	secondPanel: JSX.Element;
	class?: string;
}

export function ResizablePanel(props: ResizablePanelProps) {
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

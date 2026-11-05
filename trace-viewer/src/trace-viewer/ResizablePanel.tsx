import { createSignal, type JSX } from "solid-js";

export interface ResizablePanelProps {
	direction: "horizontal" | "vertical";
	initialFirstPanelSize?: number;
	/**
	 * Names what the panel is sized for. A size dragged to is remembered for
	 * its key, so changing the key goes back to that key's size.
	 */
	sizeKey?: string;
	minFirstPanelSize?: number;
	maxFirstPanelSize?: number;
	firstPanel: JSX.Element;
	secondPanel: JSX.Element;
	class?: string;
}

export function ResizablePanel(props: ResizablePanelProps) {
	const initialSize = () => props.initialFirstPanelSize ?? 50;
	const minSize = props.minFirstPanelSize ?? 10;
	const maxSize = props.maxFirstPanelSize ?? 90;

	const [userSizes, setUserSizes] = createSignal<Record<string, number>>({});
	const sizeKey = () => props.sizeKey ?? "";
	const firstPanelSize = () => userSizes()[sizeKey()] ?? initialSize();
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
			setUserSizes((sizes) => ({ ...sizes, [sizeKey()]: newSize }));
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
			<div
				role="separator"
				aria-orientation={isHorizontal() ? "vertical" : "horizontal"}
				aria-valuenow={Math.round(firstPanelSize())}
				aria-valuemin={minSize}
				aria-valuemax={maxSize}
				tabIndex={0}
				class={`
					${isHorizontal() ? "w-1 cursor-col-resize px-[1.5px]" : "h-1 cursor-row-resize py-[1.5px]"}
					${isDragging() ? "bg-gray-900" : "bg-gray-200 hover:bg-gray-400"}
					flex-shrink-0 bg-clip-content transition-colors
				`}
				onMouseDown={handleMouseDown}
			/>

			{/* Second Panel - takes the space left after the handle, so the
			    container never overflows by the handle's width */}
			<div
				style={{
					flex: "1 1 0px",
					[isHorizontal() ? "min-width" : "min-height"]: 0,
					overflow: "hidden",
				}}
			>
				{props.secondPanel}
			</div>
		</div>
	);
}

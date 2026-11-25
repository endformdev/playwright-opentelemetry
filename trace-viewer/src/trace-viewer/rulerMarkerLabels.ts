/**
 * Where the step ruler draws the highlights' labels, so that none overlap.
 *
 * Each label starts at its marker and runs right. In time order, a label is
 * drawn when there is room for at least MIN_LABEL_WIDTH_PX of it after the
 * one before; otherwise it is left out, and shows only while its marker is
 * hovered. A drawn label is cut short where the next one starts, and the
 * last one moves left to stay on the ruler.
 */

/** The narrowest a label is cut to before it is left out instead */
export const MIN_LABEL_WIDTH_PX = 56;
/** Space kept between two labels */
export const LABEL_GAP_PX = 4;
/** How near a marker the pointer counts as on it */
export const MARKER_HIT_SLOP_PX = 3;

export interface MarkerLabelInput {
	/** The marker's start, in pixels from the ruler's left edge */
	startPx: number;
	/** The marker's end; the same as startPx for a line */
	endPx: number;
	/** The label's full width, in pixels; null when it has no label */
	labelWidthPx: number | null;
}

export interface MarkerLabelPlacement {
	/** The label's left edge, in pixels from the ruler's left edge */
	leftPx: number;
	/** Its width; less than the full width when cut short */
	widthPx: number;
}

/** Where each marker's label goes, in the markers' order; null when left out. */
export function layoutMarkerLabels(
	markers: readonly MarkerLabelInput[],
	plotWidthPx: number,
): (MarkerLabelPlacement | null)[] {
	const placements: (MarkerLabelPlacement | null)[] = markers.map(() => null);
	if (plotWidthPx < MIN_LABEL_WIDTH_PX) return placements;

	const labelled = markers
		.map((marker, index) => ({ ...marker, index }))
		.filter(
			(marker): marker is typeof marker & { labelWidthPx: number } =>
				marker.labelWidthPx !== null,
		)
		.sort((a, b) => a.startPx - b.startPx || a.index - b.index);

	// Which labels fit, each starting at its marker (or as far right as one
	// can start on the ruler), with room for the narrowest label before it.
	const shown: { index: number; leftPx: number; fullWidthPx: number }[] = [];
	for (const marker of labelled) {
		const leftPx = Math.max(
			0,
			Math.min(marker.startPx, plotWidthPx - MIN_LABEL_WIDTH_PX),
		);
		const previous = shown.at(-1);
		if (
			previous &&
			leftPx < previous.leftPx + MIN_LABEL_WIDTH_PX + LABEL_GAP_PX
		) {
			continue;
		}
		shown.push({
			index: marker.index,
			leftPx,
			fullWidthPx: marker.labelWidthPx,
		});
	}

	let previousEndPx = Number.NEGATIVE_INFINITY;
	shown.forEach((label, position) => {
		const next = shown[position + 1];
		let { leftPx } = label;
		if (!next) {
			// The last label moves left, into free space, to be read whole.
			leftPx = Math.max(
				0,
				Math.min(
					leftPx,
					Math.max(
						previousEndPx + LABEL_GAP_PX,
						plotWidthPx - label.fullWidthPx,
					),
				),
			);
		}
		const roomPx = (next ? next.leftPx - LABEL_GAP_PX : plotWidthPx) - leftPx;
		const widthPx = Math.min(label.fullWidthPx, roomPx);
		placements[label.index] = { leftPx, widthPx };
		previousEndPx = leftPx + widthPx;
	});
	return placements;
}

/**
 * The marker under the pointer: of those it is on, the narrowest, so that a
 * marker inside another can still be picked out. Null when on none.
 */
export function markerAtPx(
	markers: readonly MarkerLabelInput[],
	pointerPx: number,
): number | null {
	let found: number | null = null;
	markers.forEach((marker, index) => {
		if (
			pointerPx < marker.startPx - MARKER_HIT_SLOP_PX ||
			pointerPx > marker.endPx + MARKER_HIT_SLOP_PX
		) {
			return;
		}
		const width = marker.endPx - marker.startPx;
		if (
			found === null ||
			width < markers[found].endPx - markers[found].startPx
		) {
			found = index;
		}
	});
	return found;
}

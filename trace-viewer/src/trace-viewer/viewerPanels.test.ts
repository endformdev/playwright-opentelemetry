import { describe, expect, it } from "vitest";
import { ALL_VIEWER_PANELS, parseViewerPanels } from "./viewerPanels";

describe("parseViewerPanels", () => {
	it("shows every panel when the parameter is missing", () => {
		expect(parseViewerPanels(null)).toEqual(ALL_VIEWER_PANELS);
	});

	it("shows only the listed panels", () => {
		expect(parseViewerPanels("viewer,details")).toEqual({
			header: false,
			ruler: false,
			filmstrip: false,
			viewer: true,
			steps: false,
			browser: false,
			external: false,
			details: true,
		});
	});

	it("shows the ruler alongside any timeline panel", () => {
		for (const timelinePanel of ["filmstrip", "steps", "browser", "external"]) {
			expect(parseViewerPanels(`viewer,${timelinePanel}`).ruler).toBe(true);
		}
		expect(parseViewerPanels("header,viewer,details").ruler).toBe(false);
		expect(parseViewerPanels("viewer,ruler").ruler).toBe(true);
	});

	it("ignores whitespace, case, duplicates and unknown names", () => {
		const panels = parseViewerPanels(" Header , viewer,viewer,unknown,");
		expect(panels.header).toBe(true);
		expect(panels.viewer).toBe(true);
		expect(Object.values(panels).filter(Boolean)).toHaveLength(2);
	});

	it("falls back to every panel when no listed name is recognised", () => {
		expect(parseViewerPanels("")).toEqual(ALL_VIEWER_PANELS);
		expect(parseViewerPanels("nope,also-nope")).toEqual(ALL_VIEWER_PANELS);
	});
});

import { describe, expect, it } from "vitest";
import {
	ALL_VIEWER_PANELS,
	parseViewerPanels,
	type ViewerPanelId,
} from "./viewerPanels";

function shownPanels(query: string): ViewerPanelId[] {
	const panels = parseViewerPanels(new URLSearchParams(query));
	return (Object.keys(panels) as ViewerPanelId[]).filter((id) => panels[id]);
}

describe("parseViewerPanels", () => {
	it("shows every panel when no parameter is given", () => {
		expect(parseViewerPanels(new URLSearchParams(""))).toEqual(
			ALL_VIEWER_PANELS,
		);
	});

	it("shows only the listed panels", () => {
		expect(shownPanels("panels=viewer,filmstrip")).toEqual([
			"filmstrip",
			"viewer",
		]);
	});

	it("ignores whitespace, case, duplicates and unknown names in panels", () => {
		expect(shownPanels("panels= Header , viewer,viewer,unknown,")).toEqual([
			"header",
			"viewer",
		]);
	});

	it("resolves view presets", () => {
		expect(shownPanels("view=full")).toEqual(shownPanels(""));
		expect(shownPanels("view=player")).toEqual([
			"ruler",
			"filmstrip",
			"viewer",
		]);
		expect(shownPanels("view=spans")).toEqual([
			"header",
			"ruler",
			"filmstrip",
			"steps",
			"browser",
			"external",
			"details",
		]);
		expect(shownPanels("view= Player ")).toEqual(shownPanels("view=player"));
	});

	it("lets an explicit panels list override the view", () => {
		expect(shownPanels("view=player&panels=viewer")).toEqual(["viewer"]);
	});

	it("falls back to the view when panels has no recognised names", () => {
		expect(shownPanels("view=player&panels=nope")).toEqual(
			shownPanels("view=player"),
		);
	});

	it("falls back to every panel for unrecognised values", () => {
		expect(shownPanels("panels=")).toEqual(shownPanels(""));
		expect(shownPanels("panels=nope,also-nope")).toEqual(shownPanels(""));
		expect(shownPanels("view=nope")).toEqual(shownPanels(""));
		expect(shownPanels("view=toString")).toEqual(shownPanels(""));
	});
});

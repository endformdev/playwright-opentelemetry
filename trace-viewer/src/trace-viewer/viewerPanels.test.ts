import { describe, expect, it } from "vitest";
import {
	parseViewerPanels,
	type ViewerPanelId,
	VIEWER_PANEL_IDS,
	viewerSettingsFromPanels,
} from "./viewerPanels";

/** The shown panel ids, or null when the URL leaves it to the saved settings */
function shownPanels(query: string): ViewerPanelId[] | null {
	const panels = parseViewerPanels(new URLSearchParams(query));
	if (!panels) return null;
	return VIEWER_PANEL_IDS.filter((id) => panels[id]);
}

describe("parseViewerPanels", () => {
	it("leaves the choice to the saved settings when no parameter is given", () => {
		expect(shownPanels("")).toBeNull();
	});

	it("shows only the listed panels", () => {
		expect(shownPanels("panels=viewer,ruler")).toEqual(["ruler", "viewer"]);
	});

	it("ignores panels since removed, such as the filmstrip", () => {
		expect(shownPanels("panels=viewer,filmstrip")).toEqual(["viewer"]);
	});

	it("ignores whitespace, case, duplicates and unknown names in panels", () => {
		expect(shownPanels("panels= Header , viewer,viewer,unknown,")).toEqual([
			"header",
			"viewer",
		]);
	});

	it("resolves view presets", () => {
		expect(shownPanels("view=full")).toEqual([...VIEWER_PANEL_IDS]);
		expect(shownPanels("view=player")).toEqual(["ruler", "viewer"]);
		expect(shownPanels("view=spans")).toEqual([
			"header",
			"ruler",
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

	it("leaves the choice to the saved settings for unrecognised values", () => {
		expect(shownPanels("panels=")).toBeNull();
		expect(shownPanels("panels=nope,also-nope")).toBeNull();
		expect(shownPanels("view=nope")).toBeNull();
		expect(shownPanels("view=toString")).toBeNull();
	});
});

describe("viewerSettingsFromPanels", () => {
	it("maps the panels the settings menu covers", () => {
		const panels = parseViewerPanels(new URLSearchParams("view=player"))!;
		expect(viewerSettingsFromPanels(panels)).toEqual({
			stepViewer: true,
			steps: false,
			browser: false,
			external: false,
			playerScreen: "big-screen",
		});
	});
});

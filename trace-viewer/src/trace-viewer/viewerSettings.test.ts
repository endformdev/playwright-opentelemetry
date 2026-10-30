import { describe, expect, it } from "vitest";
import { DEFAULT_VIEWER_SETTINGS, parseViewerSettings } from "./viewerSettings";

describe("parseViewerSettings", () => {
	it("uses defaults when nothing is stored", () => {
		expect(parseViewerSettings(null)).toEqual(DEFAULT_VIEWER_SETTINGS);
	});

	it("uses defaults for invalid JSON", () => {
		expect(parseViewerSettings("{")).toEqual(DEFAULT_VIEWER_SETTINGS);
	});

	it("keeps stored booleans and fills in missing or invalid keys", () => {
		expect(
			parseViewerSettings(
				JSON.stringify({ stepViewer: false, browser: "no", unknown: true }),
			),
		).toEqual({ ...DEFAULT_VIEWER_SETTINGS, stepViewer: false });
	});
});

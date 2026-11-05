import { describe, expect, it } from "vitest";
import { parseViewerActionId } from "./viewerAction";

function actionId(query: string) {
	return parseViewerActionId(new URLSearchParams(query));
}

describe("parseViewerActionId", () => {
	it("has no action unless the query asks for one", () => {
		expect(actionId("")).toBeNull();
		expect(actionId("action=")).toBeNull();
	});

	it("reads a known action, ignoring whitespace and case", () => {
		expect(actionId("action=expand")).toBe("expand");
		expect(actionId("action= Expand ")).toBe("expand");
	});

	it("ignores unknown actions", () => {
		expect(actionId("action=unknown")).toBeNull();
	});
});

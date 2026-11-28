import { describe, expect, it } from "vitest";
import type { TraceAction } from "../trace-info-loader";
import {
	AIM_HOLD_MS,
	BURST_AIM_HOLD_MS,
	BURST_GAP_MS,
	BURST_LANDED_HOLD_MS,
	computeActionHolds,
	FAILED_HOLD_MS,
	getActionHoldPhase,
	LANDED_HOLD_MS,
} from "./actionHolds";

const TEST_START = 1_000_000;

function action(
	startMs: number,
	endMs: number,
	extra: Partial<TraceAction> = {},
): TraceAction {
	return {
		pageId: "page-0",
		start: TEST_START + startMs,
		end: TEST_START + endMs,
		method: "click",
		failed: false,
		...extra,
	};
}

/** The same page is on show throughout. */
const onPage = (pageId: string) => () => pageId;

describe("computeActionHolds", () => {
	it("holds on each action where its input began", () => {
		const actions = [action(1000, 1040), action(3000, 3005)];
		expect(computeActionHolds(actions, TEST_START, onPage("page-0"))).toEqual([
			{
				timeMs: 1000,
				durationMs: AIM_HOLD_MS + LANDED_HOLD_MS,
				aimMs: AIM_HOLD_MS,
				action: actions[0],
			},
			{
				timeMs: 3000,
				durationMs: AIM_HOLD_MS + LANDED_HOLD_MS,
				aimMs: AIM_HOLD_MS,
				action: actions[1],
			},
		]);
	});

	it("holds for less between actions that follow each other closely", () => {
		const [first, middle, last] = computeActionHolds(
			[action(1000, 1002), action(1004, 1006), action(1008, 1010)],
			TEST_START,
			onPage("page-0"),
		);
		// Into the run at full length, through it quicker, out at full length.
		expect(first.aimMs).toBe(AIM_HOLD_MS);
		expect(first.durationMs).toBe(AIM_HOLD_MS + BURST_LANDED_HOLD_MS);
		expect(middle.aimMs).toBe(BURST_AIM_HOLD_MS);
		expect(middle.durationMs).toBe(BURST_AIM_HOLD_MS + BURST_LANDED_HOLD_MS);
		expect(last.aimMs).toBe(BURST_AIM_HOLD_MS);
		expect(last.durationMs).toBe(BURST_AIM_HOLD_MS + LANDED_HOLD_MS);
	});

	it("counts closeness from one action's end to the next one's start", () => {
		const [long, after] = computeActionHolds(
			[action(1000, 4000), action(4000 + BURST_GAP_MS, 4300)],
			TEST_START,
			onPage("page-0"),
		);
		expect(long.durationMs).toBe(AIM_HOLD_MS + LANDED_HOLD_MS);
		expect(after.aimMs).toBe(AIM_HOLD_MS);
	});

	it("stays longer on an action that failed", () => {
		const [failed] = computeActionHolds(
			[action(1000, 6000, { failed: true }), action(6010, 6020)],
			TEST_START,
			onPage("page-0"),
		);
		expect(failed.durationMs).toBe(AIM_HOLD_MS + FAILED_HOLD_MS);
	});

	it("holds only on actions whose page is on show", () => {
		const actions = [
			action(1000, 1002),
			action(1004, 1006, { pageId: "page-1" }),
			action(1008, 1010),
		];
		const holds = computeActionHolds(actions, TEST_START, onPage("page-1"));
		expect(holds.map((hold) => hold.action)).toEqual([actions[1]]);
		// The only one held on, it isn't part of a run.
		expect(holds[0].durationMs).toBe(AIM_HOLD_MS + LANDED_HOLD_MS);
	});

	it("asks which page is on show as each action's input begins", () => {
		const actions = [action(1000, 1002), action(3000, 3002)];
		const holds = computeActionHolds(actions, TEST_START, (atMs) =>
			atMs < TEST_START + 2000 ? "page-1" : "page-0",
		);
		expect(holds.map((hold) => hold.action)).toEqual([actions[1]]);
	});

	it("puts the holds in time order", () => {
		const holds = computeActionHolds(
			[action(3000, 3010), action(1000, 1010)],
			TEST_START,
			onPage("page-0"),
		);
		expect(holds.map((hold) => hold.timeMs)).toEqual([1000, 3000]);
	});
});

describe("getActionHoldPhase", () => {
	const actions = [action(1000, 1040)];
	const holds = computeActionHolds(actions, TEST_START, onPage("page-0"));

	it("is null while playback moves", () => {
		expect(getActionHoldPhase(holds, null)).toBeNull();
	});

	it("aims first, then has the input landed", () => {
		expect(getActionHoldPhase(holds, { index: 0, heldMs: 0 })).toEqual({
			action: actions[0],
			phase: "aim",
			progress: 0,
		});
		expect(
			getActionHoldPhase(holds, { index: 0, heldMs: AIM_HOLD_MS / 2 }),
		).toEqual({ action: actions[0], phase: "aim", progress: 0.5 });
		expect(
			getActionHoldPhase(holds, { index: 0, heldMs: AIM_HOLD_MS }),
		).toEqual({ action: actions[0], phase: "landed", progress: 0 });
		expect(
			getActionHoldPhase(holds, {
				index: 0,
				heldMs: AIM_HOLD_MS + LANDED_HOLD_MS / 4,
			}),
		).toEqual({ action: actions[0], phase: "landed", progress: 0.25 });
	});

	it("is null for a hold that is no longer there", () => {
		expect(getActionHoldPhase([], { index: 0, heldMs: 10 })).toBeNull();
	});
});

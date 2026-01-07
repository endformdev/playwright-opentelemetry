import type { Span } from "../trace-data-loader/exportToSpans";

export type TestPhaseType = "before-hooks" | "test-body" | "after-hooks";

export interface TestPhase {
	type: TestPhaseType;
	startMs: number;
	endMs: number;
	/** Display label for the phase */
	label: string;
}

/**
 * Detects test phases (before hooks, test body, after hooks) from step spans.
 *
 * Returns null if no hooks are detected (indicating the phase bar shouldn't be shown).
 * Returns an array of phases if at least one hook phase exists.
 *
 * The detection is case-insensitive for "before hooks" and "after hooks" titles.
 */
export function detectTestPhases(steps: Span[]): TestPhase[] | null {
	if (steps.length === 0) {
		return null;
	}

	// Find the root test span (playwright.test with no parent in steps)
	const rootTest = steps.find(
		(s) =>
			s.name === "playwright.test" && !steps.some((p) => p.id === s.parentId),
	);

	if (!rootTest) {
		return null;
	}

	// Find top-level steps (direct children of the root test)
	const topLevelSteps = steps.filter((s) => s.parentId === rootTest.id);

	// Find before hooks and after hooks (case-insensitive)
	const beforeHooks = topLevelSteps.find(
		(s) => s.title.toLowerCase() === "before hooks",
	);
	const afterHooks = topLevelSteps.find(
		(s) => s.title.toLowerCase() === "after hooks",
	);

	// If no hooks at all, don't show the phase bar
	if (!beforeHooks && !afterHooks) {
		return null;
	}

	const phases: TestPhase[] = [];
	const testStartMs = rootTest.startOffsetMs;
	const testEndMs = rootTest.startOffsetMs + rootTest.durationMs;

	// Add before hooks phase if present
	if (beforeHooks) {
		phases.push({
			type: "before-hooks",
			startMs: beforeHooks.startOffsetMs,
			endMs: beforeHooks.startOffsetMs + beforeHooks.durationMs,
			label: "Before Hooks",
		});
	}

	// Calculate test body boundaries
	const testBodyStartMs = beforeHooks
		? beforeHooks.startOffsetMs + beforeHooks.durationMs
		: testStartMs;
	const testBodyEndMs = afterHooks ? afterHooks.startOffsetMs : testEndMs;

	// Add test body phase (always present if we have hooks)
	if (testBodyEndMs > testBodyStartMs) {
		phases.push({
			type: "test-body",
			startMs: testBodyStartMs,
			endMs: testBodyEndMs,
			label: "Test Body",
		});
	}

	// Add after hooks phase if present
	if (afterHooks) {
		phases.push({
			type: "after-hooks",
			startMs: afterHooks.startOffsetMs,
			endMs: afterHooks.startOffsetMs + afterHooks.durationMs,
			label: "After Hooks",
		});
	}

	return phases;
}

/**
 * Gets the test body phase from an array of phases.
 * Returns null if no test body phase exists.
 */
export function getTestBodyPhase(phases: TestPhase[] | null): TestPhase | null {
	if (!phases) return null;
	return phases.find((p) => p.type === "test-body") ?? null;
}

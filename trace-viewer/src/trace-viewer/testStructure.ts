import type { Span } from "../trace-data-loader/exportToSpans";

const STEP_SPAN_NAME = "playwright.test.step";
const TEST_SPAN_NAME = "playwright.test";
const BEFORE_HOOKS_TITLE = "before hooks";
const AFTER_HOOKS_TITLE = "after hooks";
const HOOK_PHASES = new Set(["before", "after"]);
const NON_BODY_CATEGORIES = new Set(["hook", "fixture"]);

/**
 * The shape of a test as told by its step spans: the root test span, the
 * Before/After Hooks containers and the steps of the test body. Built once per
 * trace and shared by everything that reasons about steps.
 */
export interface TestStructure {
	/** The `playwright.test` span with no parent among the steps */
	root: Span | null;
	beforeHooks: Span | null;
	afterHooks: Span | null;
	/** Steps written in the test body (not hooks or fixtures), in start order */
	bodySteps: Span[];
	/** Body steps without body step children, in start order */
	bodyLeafSteps: Span[];
}

export function buildTestStructure(steps: Span[]): TestStructure {
	const stepsById = new Map(steps.map((step) => [step.id, step]));
	const root =
		steps.find(
			(step) =>
				step.name === TEST_SPAN_NAME &&
				(step.parentId === null || !stepsById.has(step.parentId)),
		) ?? null;
	const topLevelSteps = root
		? steps.filter((step) => step.parentId === root.id)
		: [];
	const findHooks = (title: string) =>
		topLevelSteps.find((step) => step.title.toLowerCase() === title) ?? null;
	const beforeHooks = findHooks(BEFORE_HOOKS_TITLE);
	const afterHooks = findHooks(AFTER_HOOKS_TITLE);

	const parentOf = (step: Span) =>
		step.parentId ? stepsById.get(step.parentId) : undefined;

	const isInHooks = (step: Span): boolean => {
		for (
			let current: Span | undefined = step;
			current;
			current = parentOf(current)
		) {
			if (current === beforeHooks || current === afterHooks) return true;
			if (HOOK_PHASES.has(String(current.attributes["playwright.test.phase"])))
				return true;
		}
		return false;
	};

	const bodySteps = steps
		.filter(
			(step) =>
				step.name === STEP_SPAN_NAME &&
				!NON_BODY_CATEGORIES.has(
					String(step.attributes["test.step.category"]),
				) &&
				!isInHooks(step),
		)
		.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
	const bodyParentIds = new Set(bodySteps.map((step) => step.parentId));
	const bodyLeafSteps = bodySteps.filter((step) => !bodyParentIds.has(step.id));

	return {
		root,
		beforeHooks,
		afterHooks,
		bodySteps,
		bodyLeafSteps,
	};
}

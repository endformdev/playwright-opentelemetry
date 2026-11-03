export const TEST_SPAN_NAME = "playwright.test" as const;
export const TEST_STEP_SPAN_NAME = "playwright.test.step" as const;
export const ATTR_TEST_STEP_NAME = "test.step.name" as const;
/** Playwright's step title, e.g. `Click` or `Expect "toBeVisible"` */
export const ATTR_TEST_STEP_TITLE = "test.step.title" as const;
/** What the step acted on, e.g. the locator of a `Click` or the url of a `Navigate` */
export const ATTR_TEST_STEP_SUBTITLE = "test.step.subtitle" as const;
/** Prefix for the step's reported params, e.g. `test.step.param.locator` */
export const ATTR_TEST_STEP_PARAM_PREFIX = "test.step.param." as const;
export const ATTR_TEST_STEP_CATEGORY = "test.step.category" as const;
export const ATTR_TEST_PHASE = "playwright.test.phase" as const;

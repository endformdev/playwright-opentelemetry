// For programs that run Playwright tests and seed a test attempt's trace
// context before it starts: see docs/seed-trace-context.md. Doesn't load
// Playwright or the reporter.
export {
	fixtureHandoffDir,
	TRACE_CONTEXT_HANDOFF_FILE,
	type TraceContextHandoff,
} from "../shared/fixture-handoff";

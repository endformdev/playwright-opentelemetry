# Agent Guidelines for playwright-opentelemetry

## For trace-reporter

### Build & Test Commands
- `pnpm test:unit` - Run all unit tests (vitest)
- `pnpm test:e2e` - Run e2e tests (playwright)
- `pnpm typecheck` - Type checking with tsc
- `pnpm format` - Format code with Biome

### Running Single Tests
- Unit test: `pnpm test:unit reporter.test.ts` or `pnpm test:unit -t "test name pattern"`
- E2E test: `pnpm test:e2e example.spec.ts` or `pnpm test:e2e --grep "test name"`

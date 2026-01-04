# Agent Guidelines for playwright-opentelemetry

Always run unit tests from workspace root: `pnpm tsc`
Always typecheck from workspace root: `pnpm test`
Never make types.ts files.

## For trace-reporter

### Build & Test Commands
- `pnpm test:e2e` - Run e2e tests (playwright)
- `pnpm typecheck` - Type checking with tsc
- `pnpm format` - Format code with Biome

### Running Single Tests
- E2E test: `pnpm test:e2e example.spec.ts` or `pnpm test:e2e --grep "test name"`

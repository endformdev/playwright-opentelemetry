# Agent Guidelines for playwright-opentelemetry

## Build & Test Commands
- `pnpm test:unit` - Run all unit tests (vitest)
- `pnpm test:e2e` - Run e2e tests (playwright)
- `pnpm typecheck` - Type checking with tsc
- `pnpm format` - Format code with Biome

### Running Single Tests
- Unit test: `pnpm test:unit reporter.test.ts` or `pnpm test:unit -t "test name pattern"`
- E2E test: `pnpm test:e2e example.spec.ts` or `pnpm test:e2e --grep "test name"`

## Code Style
- **Formatting**: Tabs for indentation, double quotes for strings (Biome enforced)
- **Imports**: Node built-ins use `node:` prefix (e.g., `node:path`, `node:fs`), organize imports automatically
- **Naming**: camelCase for variables/functions, PascalCase for classes/types, SCREAMING_SNAKE_CASE for constants
- **Error Handling**: Throw descriptive errors with context, use `Error` class with meaningful messages
- **Async**: Use `async/await` over promises, handle rejections explicitly
- **Files**: Source in `src/`, unit tests in `test-unit/`, e2e tests in `test-e2e/`

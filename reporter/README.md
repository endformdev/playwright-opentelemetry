# `playwright-opentelemetry`

A combination of a Playwright reporter and a fixture that allows you to create opentelemetry spans for playwright end-to-end tests.

For more information on getting started, check out the main [readme](../README.md).

## Developing the reporter / fixture

- `pnpm dev` starts a dev server that outputs `dist/index.mjs`
- `pnpm build` otherwise creates a one-off compiled build
- `pnpm test:e2e` uses the compiled reporter output

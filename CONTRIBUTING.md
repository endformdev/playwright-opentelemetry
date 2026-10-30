# Contributing to Playwright OpenTelemetry

Thanks for your interest in contributing! This document covers development setup, commands, and the release process.

The most useful contribution of all is telling us where a trace still goes dark on your stack: [open an issue](https://github.com/endformdev/playwright-opentelemetry/issues).

## Prerequisites

- Node.js 24
- [pnpm](https://pnpm.io) (see `packageManager` in `package.json` for the exact version)

## Setup

```bash
git clone https://github.com/endformdev/playwright-opentelemetry.git
cd playwright-opentelemetry
pnpm install
```

## Repository layout

This is a pnpm workspace with three published packages:

- `reporter/` — the `playwright-opentelemetry` package (reporter + fixture)
- `trace-viewer/` — the `@playwright-opentelemetry/trace-viewer` package (SolidJS SPA + CLI)
- `trace-api/` — the `@playwright-opentelemetry/trace-api` package (H3 library)

## Root-level commands

- `pnpm test` runs the unit tests (vitest)
- `pnpm tsc` typechecks all packages
- `pnpm format` formats files with Biome
- `pnpm build` builds all packages

## Package-level commands

### `reporter/`

- `pnpm dev` starts a dev server that outputs `dist/index.mjs`
- `pnpm build` creates a one-off compiled build
- `pnpm test:e2e` runs the Playwright e2e tests against the compiled reporter output
  - Run a single test file: `pnpm test:e2e example.spec.ts`
  - Filter by name: `pnpm test:e2e --grep "test name"`

### `trace-viewer/`

- `pnpm dev` starts the Vite dev server
- `pnpm test:e2e` runs the viewer e2e tests (builds and serves the viewer and a test Trace API automatically)
- `pnpm test:e2e:live` runs the live trace e2e tests on demand. It serves the viewer and the live trace Worker under `wrangler dev`, then runs a producer test and an observer test side by side: the observer checks each part of the producer's live trace arrives in the viewer while the producer is paused. Add `--keep-open` to keep the servers running, so the producer's live trace and the observer's own trace, printed in the output, can be opened afterwards

### `trace-api/`

- `pnpm dev` builds in watch mode
- `pnpm test:unit` runs the unit tests

## Before opening a pull request

Please run from the workspace root:

```bash
pnpm format
pnpm tsc
pnpm test
```

CI runs formatting checks, typechecking, unit tests, builds, and both e2e suites on every pull request.

## Releasing

Maintainers release all packages (`playwright-opentelemetry`, `@playwright-opentelemetry/trace-viewer`, and `@playwright-opentelemetry/trace-api`) together:

```bash
pnpm release
```

This bumps all packages to the same version, commits, tags, and pushes to trigger the publish workflow. Release notes are generated on the [GitHub Releases](https://github.com/endformdev/playwright-opentelemetry/releases) page.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 license](LICENSE).

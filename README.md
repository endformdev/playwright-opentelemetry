# Playwright Opentelemetry Reporter

We're building a reporter for Playwright that can export traces and spans in opentelemetry format.

We're just getting started, this project is in early development. Reach out if you're interested in learning more!

## Development

- `pnpm dev` starts a dev server that outputs `dist/index.mjs`
- `pnpm build` otherwise creates a one-off compiled build
- `pnpm test:unit` to run the unit tests
- `pnpm test:e2e` uses the compiled reporter output
- `pnpm typecheck` for typescript
- `pnpm format` to format files
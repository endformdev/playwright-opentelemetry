---
title: Deploy your own Trace API
description: Store and serve traces from your own S3-compatible storage with the @playwright-opentelemetry/trace-api package.
sidebar:
  order: 5
---

The `@playwright-opentelemetry/trace-api` package provides a customizable H3-based library for storing and serving traces from S3-compatible storage. You can deploy it to Cloudflare Workers, Deno, Bun, Node.js, or any platform supporting web-standard Request/Response handlers.

It serves the [Trace API](output-formats.md#trace-api) that the trace viewer reads. See the [trace-api README](../trace-api/README.md) for installation, usage examples, and deployment instructions.

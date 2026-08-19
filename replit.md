# OpenNext Split Deploy Engine

Local tooling that analyzes an OpenNext build and separates CDN assets, Worker code, and Lambda code into `.open-next-split/`.

## Run & Operate

- `pnpm install` — install all workspace dependencies
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm split-deploy analyze` — analyze the default `.open-next` output and print classification
- `pnpm split-deploy analyze --split` — analyze and write split artifacts
- `pnpm split-deploy build` — run OpenNext build, analyze, and write `.open-next-split/`
- `pnpm --filter @workspace/split-deploy run test` — run unit + integration tests
- `pnpm --filter @workspace/split-deploy run split-deploy -- analyze --input <dir>` — analyze a specific OpenNext output

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- No cloud SDKs, no remote APIs, no authentication

## Where things live

- `packages/split-deploy/src/` — OpenNext reader, route detection, import scanning, classification, artifact copying, validation, and CLI
- `packages/split-deploy/src/split-deploy.test.ts` — unit tests (fixture-backed)
- `packages/split-deploy/src/integration.test.ts` — real OpenNext build integration tests
- `examples/next-app/` — App Router example demonstrating all three targets (CDN, Worker, Lambda)

## Architecture decisions

- The CLI uses only Node.js built-ins; no cloud SDK or remote service is required.
- Relative JavaScript imports are followed transitively so every shared chunk is collected with its entrypoint.
- Static/prerendered routes go to `cdn`; edge-compatible API routes (auto-detected by absence of blocked imports) go to `worker`; functions using Node built-ins default to `lambda`.
- CDN entries never contribute server-side files to the CDN artifact — only the `assets/` directory is copied.
- The split output preserves each source file's relative path and writes `manifest.json` beside the three artifact directories.
- Tenant and build isolation is supported via `--tenant` and `--build` flags, outputting to `tenants/<id>/<build>/`.

## Gotchas

- The CLI expects a real OpenNext output directory; use `--input` when it is not `.open-next`.
- `analyze --split` and `build` replace the output directory before copying artifacts.
- The classifier is conservative: any route with an unresolvable entry or unknown compatibility is sent to Lambda.
- Integration tests require `npm install` + `npx open-next build` in `examples/next-app`; set `SKIP_INTEGRATION=1` to skip.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

# OpenNext Split Deploy Engine

Local tooling that analyzes an OpenNext build and separates CDN assets, worker code, and Lambda code into `.open-next-split/`.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm split-deploy analyze` — inspect the default `.open-next` build
- `pnpm split-deploy build` — write the default `.open-next-split` output
- `pnpm --filter @workspace/split-deploy run test` — run CLI tests
- `pnpm --filter @workspace/split-deploy run split-deploy -- analyze --input <dir>` — analyze a specific OpenNext output
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `packages/split-deploy/src/` — OpenNext reader, route detection, import scanning, classification, copying, and CLI
- `packages/split-deploy/src/split-deploy.test.ts` — deterministic fixture-backed tests
- `examples/next-app/` — small App Router example with static, dynamic, API, and middleware routes
- `lib/api-spec/openapi.yaml` — source of truth for the existing API artifact; unrelated to the local split CLI

## Architecture decisions

- The CLI uses only Node.js built-ins; it does not require a cloud SDK or remote service.
- Relative JavaScript imports are followed into the build output so shared chunks are copied with their entry.
- Static routes and conventional asset directories go to `cdn`; edge and middleware code goes to `worker`; server functions default to `lambda`.
- The split output preserves each source file's relative path and writes `analysis.json` beside the three artifact directories.

## Product

The MVP provides two local commands: `analyze` prints route, runtime, asset, and dependency information; `build` copies the analyzed closure into `cdn/`, `worker/`, and `lambda/`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The CLI expects a real OpenNext output directory; use `--input` when it is not `.open-next`.
- `build` replaces the selected output directory before copying artifacts.
- The analyzer is intentionally conservative: a route with Node built-in imports is treated as Lambda-compatible, while explicit edge metadata is treated as worker code.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

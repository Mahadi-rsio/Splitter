# Split Deploy

A local CLI and core engine that analyzes an [OpenNext](https://opennext.js.org) build and separates the resulting artifacts into three runtime targets:

```
Next.js
  ↓
OpenNext
  ↓
.open-next/
  ↓
split-deploy
  ↓
.open-next-split/
├── cdn/       ← static assets and prerendered output
├── worker/    ← edge-compatible server code
├── lambda/    ← Node.js server functions
└── manifest.json
```

No cloud credentials, no deployment, no authentication — everything runs locally.

---

## Quick Start

### 1. Install the example app and run an OpenNext build

```bash
cd examples/next-app
npm install
npx open-next build
```

### 2. Analyze the build

```bash
pnpm split-deploy analyze
```

Example output:

```
Split Deploy

✓ OpenNext output detected
✓ Routes analyzed
✓ Dependencies analyzed

Routes

  CDN
    /
    /books/1
    /books/2
    /books/3

  WORKER
    /api/search

  LAMBDA
    /api/invoice  (node:fs, node:path)
    /books/[id]
```

### 3. Generate split artifacts

```bash
pnpm split-deploy build
```

Or, without re-running the OpenNext build:

```bash
pnpm split-deploy analyze --split
```

### Tenant and build isolation

```bash
pnpm split-deploy analyze --split --tenant tenant-a --build build-001
```

Output goes to:

```
.open-next-split/
└── tenants/
    └── tenant-a/
        └── build-001/
            ├── cdn/
            ├── worker/
            ├── lambda/
            └── manifest.json
```

---

## CLI Reference

```
split-deploy build   [options]   Run OpenNext build, analyze, and split
split-deploy analyze [options]   Analyze existing OpenNext output

Options:
  -i, --input <dir>     OpenNext output directory  (default: .open-next)
  -o, --output <dir>    Split output directory      (default: .open-next-split)
  --tenant <id>         Tenant identifier
  --build <id>          Build identifier
  --json                Print machine-readable analysis
  --split               Generate split output (with analyze command)
```

---

## How it Works

### Architecture

```
OpenNext Reader
      ↓
Route Analyzer        ← routes-manifest, prerender-manifest, app-paths-manifest
      ↓
Import Scanner        ← transitive JS dependency graph
      ↓
Runtime Classifier
      ↓
  ┌───┴────────────┐
  CDN   Worker   Lambda
  ↓       ↓        ↓
Artifact Collector
      ↓
Artifact Validator
      ↓
.open-next-split/
```

### Classification Rules

| Condition | Target |
|---|---|
| Static or prerendered route | CDN |
| Middleware or explicit edge runtime | Worker |
| Explicit Node.js runtime | Lambda |
| API route with no blocked dependencies | Worker |
| Node built-in or native dependency detected | Lambda |
| Unknown compatibility | Lambda (safe default) |

### Zero-Config Edge Detection

The engine automatically detects Worker-compatible routes by scanning the generated JavaScript for blocked Node.js imports. You do **not** need to add `export const runtime = "edge"`. If the code only uses Web/fetch APIs, it is classified as Worker.

### Blocked Modules

The following (and their `node:` prefixed variants) force Lambda classification:

`fs`, `child_process`, `net`, `tls`, `dgram`, `worker_threads`, `cluster`, `sharp`, `@prisma/client`, `pg`, and more (see `src/blocked-modules.ts`).

### Output Manifest

`manifest.json` records enough for a future deployer:

```json
{
  "version": 1,
  "buildId": "build-mszyt5qb",
  "tenantId": "local",
  "routes": {
    "/": { "target": "cdn" },
    "/api/search": { "target": "worker", "entrypoint": "..." },
    "/api/invoice": { "target": "lambda", "entrypoint": "..." }
  },
  "cdn": { "files": ["assets/..."] },
  "worker": { "entrypoints": ["..."], "files": ["..."] },
  "lambda": { "functions": { "...": { "entrypoint": "...", "files": ["..."] } } }
}
```

---

## Repository Layout

```
packages/
└── split-deploy/
    └── src/
        ├── types.ts              shared type definitions
        ├── reader.ts             OpenNext output abstraction layer
        ├── routes.ts             manifest-based route detection
        ├── imports.ts            transitive JS import scanner
        ├── blocked-modules.ts    Node-only module list
        ├── dependency-graph.ts   graph builder + shared chunk detection
        ├── classify.ts           runtime target classifier
        ├── analyze.ts            full analysis pipeline
        ├── copy.ts               artifact copier + manifest writer
        ├── validator.ts          post-split artifact validation
        ├── cli.ts                CLI entry point
        ├── split-deploy.test.ts  unit + integration tests
        └── integration.test.ts   real OpenNext build tests

examples/
└── next-app/           intentional demonstration app
    ├── app/page.tsx               → CDN (static)
    ├── app/books/[id]/page.tsx    → CDN (prerendered via generateStaticParams)
    ├── app/api/search/route.ts    → Worker (fetch-only, auto-detected)
    └── app/api/invoice/route.ts   → Lambda (uses node:fs)
```

---

## Development

```bash
# Install all dependencies
pnpm install

# Run unit + integration tests
pnpm --filter @workspace/split-deploy run test

# Typecheck
pnpm --filter @workspace/split-deploy run typecheck

# Build (compiles to dist/)
pnpm --filter @workspace/split-deploy run build
```

### Running against a custom OpenNext output

```bash
pnpm --filter @workspace/split-deploy run split-deploy -- analyze --input /path/to/.open-next
```

### Skipping the integration test

The integration test runs the real OpenNext build by default. Skip it with:

```bash
SKIP_INTEGRATION=1 pnpm --filter @workspace/split-deploy run test
```

---

## Supported OpenNext Layouts

The reader handles both known OpenNext output formats without hardcoding paths:

| Layout | Detection |
|---|---|
| AWS (`server-functions/default/`) | `server-functions/` directory with subdirectory bundles |
| Cloudflare (`worker.js` + `assets/`) | `worker.js` at root |
| Flat server function entries | `server-functions/*.js` without subdirectory |

Manifests are located by filename anywhere in the output tree.

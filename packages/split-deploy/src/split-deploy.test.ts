import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyzeOpenNext } from "./analyze.js";
import { hasBlockedDependency } from "./blocked-modules.js";
import { classifyRoute } from "./classify.js";
import { runCli } from "./cli.js";
import { copySplitArtifacts } from "./copy.js";
import { findSharedChunks } from "./dependency-graph.js";
import { scanJavaScriptDependencies } from "./imports.js";
import { readOpenNextBuild } from "./reader.js";
import { validateSplitOutput } from "./validator.js";
import type { DependencyScan, RouteDefinition, SplitManifest } from "./types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRoute(overrides: Partial<RouteDefinition> = {}): RouteDefinition {
  return { path: "/test", kind: "unknown", runtime: "unknown", chunks: [], ...overrides };
}

function makeScan(overrides: Partial<DependencyScan> = {}): DependencyScan {
  return { entry: "x.js", files: ["x.js"], externalImports: [], nodeBuiltins: [], ...overrides };
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "split-deploy-"));

  writeFileSync(
    join(root, "routes-manifest.json"),
    JSON.stringify({
      staticRoutes: [{ page: "/" }],
      dynamicRoutes: [{ page: "/books/[id]" }],
      routes: [
        { path: "/api/search", type: "api", entry: "server-functions/search.js" },
        { path: "/api/invoice", type: "api", entry: "server-functions/invoice.js" },
      ],
    }),
  );

  writeFileSync(
    join(root, "prerender-manifest.json"),
    JSON.stringify({
      routes: {
        "/": { initialRevalidateSeconds: false },
        "/books/1": { initialRevalidateSeconds: false },
        "/books/2": { initialRevalidateSeconds: false },
        "/books/3": { initialRevalidateSeconds: false },
      },
    }),
  );

  mkdirSync(join(root, "assets", "_next", "static"), { recursive: true });
  writeFileSync(join(root, "assets", "_next", "static", "abc.js"), "/* chunk */");
  writeFileSync(join(root, "assets", "favicon.ico"), "icon");

  mkdirSync(join(root, "server-functions"), { recursive: true });
  writeFileSync(
    join(root, "server-functions", "search.js"),
    "import './shared-chunk.js';\nexport default function() { return fetch('https://api.example.com'); }",
  );
  writeFileSync(
    join(root, "server-functions", "invoice.js"),
    "import fs from 'node:fs';\nimport './shared-chunk.js';\nimport './invoice-helper.js';\nexport default function() { return fs.readFileSync('/tmp/x'); }",
  );
  writeFileSync(
    join(root, "server-functions", "invoice-helper.js"),
    "import path from 'node:path';\nexport const p = path.join('/a', 'b');",
  );
  writeFileSync(
    join(root, "server-functions", "shared-chunk.js"),
    "export const VERSION = '1.0.0';",
  );

  writeFileSync(join(root, "worker.js"), "export default { fetch() { return new Response('ok'); } }");

  return root;
}

// ---------------------------------------------------------------------------
// Reader tests
// ---------------------------------------------------------------------------

test("reader: detects assets, manifests, server functions", () => {
  const root = fixture();
  const build = readOpenNextBuild(root);
  ok(build.manifests.some((m) => m.file === "routes-manifest.json"));
  ok(build.manifests.some((m) => m.file === "prerender-manifest.json"));
  ok(build.assetFiles.length >= 2);
  ok(build.workerEntries.includes("worker.js"));
});

// ---------------------------------------------------------------------------
// Import scanner tests
// ---------------------------------------------------------------------------

test("import scanner: detects Node builtins transitively", () => {
  const root = fixture();
  const scan = scanJavaScriptDependencies(root, "server-functions/invoice.js");
  ok(scan.nodeBuiltins.includes("node:fs"));
  ok(scan.nodeBuiltins.includes("node:path"));
  ok(scan.files.includes("server-functions/invoice-helper.js"));
  ok(scan.files.includes("server-functions/shared-chunk.js"));
});

test("import scanner: clean edge code has no Node builtins", () => {
  const root = fixture();
  const scan = scanJavaScriptDependencies(root, "server-functions/search.js");
  deepEqual(scan.nodeBuiltins, []);
});

test("import scanner: detects dynamic imports", () => {
  const root = mkdtempSync(join(tmpdir(), "split-deploy-dyn-"));
  writeFileSync(join(root, "entry.js"), "const x = await import('sharp');\nexport default x;");
  const scan = scanJavaScriptDependencies(root, "entry.js");
  ok(scan.externalImports.includes("sharp"));
});

test("import scanner: detects require calls", () => {
  const root = mkdtempSync(join(tmpdir(), "split-deploy-req-"));
  writeFileSync(join(root, "entry.js"), "const pg = require('pg');\nmodule.exports = pg;");
  const scan = scanJavaScriptDependencies(root, "entry.js");
  ok(scan.externalImports.includes("pg"));
});

// ---------------------------------------------------------------------------
// Classification tests
// ---------------------------------------------------------------------------

test("classify: static → CDN", () => {
  equal(classifyRoute(makeRoute({ path: "/", kind: "static" })), "cdn");
});

test("classify: prerendered → CDN", () => {
  equal(classifyRoute(makeRoute({ path: "/books/1", kind: "prerendered" })), "cdn");
});

test("classify: explicit edge runtime → Worker", () => {
  equal(classifyRoute(makeRoute({ path: "/edge", kind: "server", runtime: "edge" })), "worker");
});

test("classify: middleware → Worker", () => {
  equal(classifyRoute(makeRoute({ path: "/mid", kind: "middleware" })), "worker");
});

test("classify: explicit node runtime → Lambda", () => {
  equal(classifyRoute(makeRoute({ path: "/api/x", kind: "api", runtime: "node" })), "lambda");
});

test("classify: API with blocked dependency → Lambda", () => {
  equal(
    classifyRoute(
      makeRoute({ path: "/api/invoice", kind: "api" }),
      makeScan({ nodeBuiltins: ["node:fs"] }),
    ),
    "lambda",
  );
});

test("classify: API with no blocked dependencies → Worker", () => {
  equal(
    classifyRoute(
      makeRoute({ path: "/api/search", kind: "api" }),
      makeScan({ nodeBuiltins: [], externalImports: [] }),
    ),
    "worker",
  );
});

test("classify: unknown → Lambda (safety default)", () => {
  equal(classifyRoute(makeRoute({ path: "/unknown", kind: "unknown" })), "lambda");
});

test("classify: transitive dependency through helper → Lambda", () => {
  // Route imports helper which imports node:fs
  equal(
    classifyRoute(
      makeRoute({ path: "/api/gen", kind: "api" }),
      makeScan({ nodeBuiltins: ["node:fs"], externalImports: [] }),
    ),
    "lambda",
  );
});

test("classify: dynamic import of sharp → Lambda", () => {
  equal(
    classifyRoute(
      makeRoute({ path: "/api/img", kind: "api" }),
      makeScan({ nodeBuiltins: [], externalImports: ["sharp"] }),
    ),
    "lambda",
  );
});

// ---------------------------------------------------------------------------
// Blocked modules tests
// ---------------------------------------------------------------------------

test("blocked modules: node:fs is blocked", () => {
  ok(hasBlockedDependency(["node:fs"], []));
});

test("blocked modules: sharp is blocked", () => {
  ok(hasBlockedDependency([], ["sharp"]));
});

test("blocked modules: @prisma/client is blocked", () => {
  ok(hasBlockedDependency([], ["@prisma/client"]));
});

test("blocked modules: zod is not blocked", () => {
  ok(!hasBlockedDependency([], ["zod"]));
});

test("blocked modules: fetch is not blocked", () => {
  ok(!hasBlockedDependency([], []));
});

// ---------------------------------------------------------------------------
// Shared chunks
// ---------------------------------------------------------------------------

test("shared chunks: detects files used by multiple entries", () => {
  const scans: DependencyScan[] = [
    makeScan({ entry: "a.js", files: ["a.js", "shared.js"] }),
    makeScan({ entry: "b.js", files: ["b.js", "shared.js"] }),
  ];
  const shared = findSharedChunks(scans);
  ok(shared.includes("shared.js"));
  ok(!shared.includes("a.js"));
});

// ---------------------------------------------------------------------------
// Full pipeline tests
// ---------------------------------------------------------------------------

test("analyze: classifies routes correctly", () => {
  const root = fixture();
  const analysis = analyzeOpenNext(root);

  const home = analysis.routes.find((r) => r.path === "/");
  ok(home, "/ route not found");
  equal(home.target, "cdn");

  const search = analysis.routes.find((r) => r.path === "/api/search");
  ok(search, "/api/search route not found");
  equal(search.target, "worker");

  const invoice = analysis.routes.find((r) => r.path === "/api/invoice");
  ok(invoice, "/api/invoice route not found");
  equal(invoice.target, "lambda");
});

test("analyze: prerendered books → CDN", () => {
  const root = fixture();
  const analysis = analyzeOpenNext(root);
  for (const path of ["/books/1", "/books/2", "/books/3"]) {
    const route = analysis.routes.find((r) => r.path === path);
    ok(route, `${path} not found`);
    equal(route.target, "cdn", `${path} should be CDN`);
  }
});

// ---------------------------------------------------------------------------
// Copy & validation tests
// ---------------------------------------------------------------------------

test("copy: produces valid split output", () => {
  const root = fixture();
  const analysis = analyzeOpenNext(root);
  const output = join(root, "..", "split-output");
  const result = copySplitArtifacts(analysis, { output });

  ok(result.copied.cdn.includes("assets/_next/static/abc.js"));
  ok(result.copied.worker.includes("worker.js"));

  ok(existsSync(result.manifestPath));
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as SplitManifest;
  equal(manifest.version, 1);
  ok(manifest.routes["/"]);
  equal(manifest.routes["/"].target, "cdn");
});

test("copy: tenant/build path structure", () => {
  const root = fixture();
  const analysis = analyzeOpenNext(root);
  const output = join(root, "..", "tenant-output");
  const result = copySplitArtifacts(analysis, {
    output,
    tenantId: "tenant-a",
    buildId: "build-001",
  });

  ok(result.outputDir.includes("tenants/tenant-a/build-001"));
  ok(existsSync(join(result.outputDir, "manifest.json")));
  ok(existsSync(join(result.outputDir, "cdn")));
  ok(existsSync(join(result.outputDir, "worker")));
  ok(existsSync(join(result.outputDir, "lambda")));
});

test("validation: passes on valid output", () => {
  const root = fixture();
  const analysis = analyzeOpenNext(root);
  const output = join(root, "..", "valid-output");
  const result = copySplitArtifacts(analysis, { output });
  const errors = validateSplitOutput(result.outputDir);
  deepEqual(errors, []);
});

// ---------------------------------------------------------------------------
// Isolation tests
// ---------------------------------------------------------------------------

test("isolation: Lambda dependency not in Worker artifact", () => {
  const root = fixture();
  const analysis = analyzeOpenNext(root);
  const output = join(root, "..", "isolation-output");
  copySplitArtifacts(analysis, { output });

  // invoice-helper.js uses node:path, so it should NOT be in worker/
  ok(!existsSync(join(output, "worker", "server-functions", "invoice-helper.js")),
    "Lambda-only file should not appear in worker artifact");
});

// ---------------------------------------------------------------------------
// CLI tests
// ---------------------------------------------------------------------------

test("cli: no args prints usage and returns 1", () => {
  const output: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string) => { output.push(s); return true; };
  const code = runCli([]);
  process.stdout.write = orig;
  equal(code, 1);
  ok(output.some((s) => s.includes("Usage:")));
});

test("cli: --help prints usage and returns 0", () => {
  const output: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string) => { output.push(s); return true; };
  const code = runCli(["--help"]);
  process.stdout.write = orig;
  equal(code, 0);
  ok(output.some((s) => s.includes("Usage:")));
});

test("cli: unknown command returns 1", () => {
  const errors: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s: string) => { errors.push(s); return true; };
  const code = runCli(["deploy"]);
  process.stderr.write = orig;
  equal(code, 1);
  ok(errors.some((s) => s.includes("Unknown command")));
});

test("cli: unknown flag throws and returns 1", () => {
  const errors: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s: string) => { errors.push(s); return true; };
  const code = runCli(["analyze", "--unknown-flag"]);
  process.stderr.write = orig;
  equal(code, 1);
  ok(errors.some((s) => s.includes("Unknown argument")));
});

test("cli: analyze on missing input dir returns 1", () => {
  const output: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string) => { output.push(s); return true; };
  const code = runCli(["analyze", "--input", "/nonexistent-dir-xyz"]);
  process.stdout.write = origOut;
  equal(code, 1);
  ok(output.some((s) => s.includes("OpenNext output not found") || s.includes("not found")));
});

test("cli: analyze produces summary output", () => {
  const root = fixture();
  const output: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string) => { output.push(s); return true; };
  const code = runCli(["analyze", "--input", root]);
  process.stdout.write = origOut;
  equal(code, 0);
  const combined = output.join("");
  ok(combined.includes("Routes analyzed") || combined.includes("cdn") || combined.includes("worker"));
});

test("cli: analyze --json outputs valid JSON", () => {
  const root = fixture();
  const output: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string) => { output.push(s); return true; };
  const code = runCli(["analyze", "--json", "--input", root]);
  process.stdout.write = origOut;
  equal(code, 0);
  const jsonChunk = output.find((s) => s.trimStart().startsWith("{"));
  ok(jsonChunk, "expected JSON output");
  const parsed = JSON.parse(jsonChunk!) as { routes: unknown[] };
  ok(Array.isArray(parsed.routes));
});

test("cli: analyze --split generates output directory", () => {
  const root = fixture();
  const outputDir = join(root, "cli-split-out");
  const stdChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string) => { stdChunks.push(s); return true; };
  const code = runCli(["analyze", "--split", "--input", root, "--output", outputDir]);
  process.stdout.write = origOut;
  equal(code, 0);
  ok(existsSync(join(outputDir, "manifest.json")));
  ok(existsSync(join(outputDir, "cdn")));
  ok(existsSync(join(outputDir, "worker")));
  ok(existsSync(join(outputDir, "lambda")));
});

test("cli: analyze --split with tenant/build uses nested path", () => {
  const root = fixture();
  const outputBase = join(root, "cli-tenant-out");
  const stdChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string) => { stdChunks.push(s); return true; };
  const code = runCli([
    "analyze", "--split",
    "--input", root,
    "--output", outputBase,
    "--tenant", "acme",
    "--build", "v1",
  ]);
  process.stdout.write = origOut;
  equal(code, 0);
  ok(existsSync(join(outputBase, "tenants", "acme", "v1", "manifest.json")));
});

test("cli: -- prefix is stripped from args", () => {
  const output: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s: string) => { output.push(s); return true; };
  const code = runCli(["--", "--help"]);
  process.stdout.write = orig;
  equal(code, 0);
  ok(output.some((s) => s.includes("Usage:")));
});

test("isolation: CDN has no server entrypoints", () => {
  const root = fixture();
  const analysis = analyzeOpenNext(root);
  const output = join(root, "..", "cdn-isolation-output");
  copySplitArtifacts(analysis, { output });

  ok(!existsSync(join(output, "cdn", "server-functions")),
    "CDN should not contain server-functions");
  ok(!existsSync(join(output, "cdn", "worker.js")),
    "CDN should not contain worker.js");
});

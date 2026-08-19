/**
 * Integration test: runs a real OpenNext build on examples/next-app,
 * then runs the split-deploy analyze and build pipeline.
 *
 * Requires: npm install + npx open-next build to succeed in the example app.
 * Skip with: SKIP_INTEGRATION=1
 */
import { equal, ok } from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { test } from "node:test";
import { analyzeOpenNext } from "./analyze.js";
import { copySplitArtifacts } from "./copy.js";
import { validateSplitOutput } from "./validator.js";
import type { SplitManifest } from "./types.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const EXAMPLE_DIR = resolve(import.meta.dirname, "../../..", "examples/next-app");
const OPEN_NEXT_DIR = join(EXAMPLE_DIR, ".open-next");
const SPLIT_DIR = join(EXAMPLE_DIR, ".open-next-split");

function skipOrRun(name: string, fn: () => void) {
  if (SKIP) {
    test(name, { skip: "SKIP_INTEGRATION=1" }, () => {});
  } else {
    test(name, fn);
  }
}

// Build step — run once, tested by all integration tests
let buildDone = false;
function ensureBuild() {
  if (buildDone) return;

  if (!existsSync(OPEN_NEXT_DIR)) {
    console.log("Installing example app dependencies...");
    execSync("npm install", { cwd: EXAMPLE_DIR, stdio: "pipe" });

    console.log("Running OpenNext build...");
    execSync("npx open-next build", { cwd: EXAMPLE_DIR, stdio: "pipe", timeout: 120_000 });
  }

  ok(existsSync(OPEN_NEXT_DIR), ".open-next directory should exist after build");
  buildDone = true;
}

skipOrRun("integration: OpenNext build produces output", () => {
  ensureBuild();
  ok(existsSync(OPEN_NEXT_DIR));
  ok(
    existsSync(join(OPEN_NEXT_DIR, "assets")) ||
    existsSync(join(OPEN_NEXT_DIR, "server-functions")) ||
    existsSync(join(OPEN_NEXT_DIR, "worker.js")),
    "OpenNext output should contain assets, server-functions, or worker.js",
  );
});

skipOrRun("integration: analyze produces route classification", () => {
  ensureBuild();
  const analysis = analyzeOpenNext(OPEN_NEXT_DIR);
  ok(analysis.routes.length > 0, "Should detect at least one route");
  ok(analysis.assets.length > 0 || analysis.files.cdn.length > 0, "Should detect CDN assets");
  console.log(`  Detected ${analysis.routes.length} routes, ${analysis.assets.length} assets`);
  for (const route of analysis.routes) {
    console.log(`    ${route.path} → ${route.target} (${route.kind})`);
  }
});

skipOrRun("integration: split produces valid artifacts", () => {
  ensureBuild();
  const analysis = analyzeOpenNext(OPEN_NEXT_DIR);
  const result = copySplitArtifacts(analysis, { output: SPLIT_DIR });

  ok(existsSync(join(result.outputDir, "cdn")), "cdn/ should exist");
  ok(existsSync(join(result.outputDir, "worker")), "worker/ should exist");
  ok(existsSync(join(result.outputDir, "lambda")), "lambda/ should exist");
  ok(existsSync(join(result.outputDir, "manifest.json")), "manifest.json should exist");

  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as SplitManifest;
  equal(manifest.version, 1);
  ok(Object.keys(manifest.routes).length > 0, "manifest should contain routes");

  const errors = validateSplitOutput(result.outputDir);
  if (errors.length > 0) {
    console.log("Validation errors:");
    for (const err of errors) console.log(`  [${err.target}] ${err.message}`);
  }
  equal(errors.length, 0, "Split output should pass validation");
});

// Route classification expectations for the example app:
//   /books/1..3 are statically prerendered            → CDN
//   /api/search is pure fetch/edge-safe code          → Worker
//   /api/invoice uses node:fs                          → Lambda
// Worker artifacts must never contain native binaries or hard-blocked builtins.
skipOrRun("integration: route targets match expectations", () => {
  ensureBuild();
  const analysis = analyzeOpenNext(OPEN_NEXT_DIR);
  const target = new Map(analysis.routes.map((r) => [r.path, r.target]));

  for (const p of ["/books/1", "/books/2", "/books/3"]) {
    equal(target.get(p), "cdn", `${p} should be CDN (prerendered)`);
  }
  equal(target.get("/api/search"), "worker", "/api/search should be Worker");
  equal(target.get("/api/invoice"), "lambda", "/api/invoice uses node:fs → Lambda");

  const workerRoute = analysis.routes.find((r) => r.path === "/api/search");
  ok(workerRoute?.verification, "Worker route should carry verification data");
  ok(workerRoute?.verification?.workerCompatible === true, "Worker route verification should pass");
});

skipOrRun("integration: worker artifact has no native files or hard-blocked builtins", () => {
  ensureBuild();
  const result = copySplitArtifacts(analyzeOpenNext(OPEN_NEXT_DIR), { output: SPLIT_DIR });

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const f of readdirSync(dir, { recursive: true }) as string[]) {
      out.push(f);
    }
    return out;
  };

  const workerFiles = walk(join(result.outputDir, "worker"));
  ok(workerFiles.length > 0, "worker artifact should contain files");
  ok(workerFiles.every((f) => !f.endsWith(".node")), "worker must not contain native binaries");
  ok(
    workerFiles.every(
      (f) => !/(^|\/)fs(\/|$)|child_process|worker_threads|node:fs|node:child_process/.test(f),
    ),
    "worker must not contain hard-blocked builtin module files",
  );

  const workerEntrypoints = (JSON.parse(
    readFileSync(result.manifestPath, "utf8"),
  ) as SplitManifest).worker?.entrypoints ?? [];
  ok(workerEntrypoints.length > 0, "worker manifest should list entrypoints");
  for (const entry of workerEntrypoints) {
    ok(existsSync(join(result.outputDir, "worker", entry)), `worker entry exists: ${entry}`);
  }
});

skipOrRun("integration: lambda has complete runtime and native deps", () => {
  ensureBuild();
  const result = copySplitArtifacts(analyzeOpenNext(OPEN_NEXT_DIR), { output: SPLIT_DIR });
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as SplitManifest;

  const functions = Object.values(manifest.lambda?.functions ?? {});
  ok(functions.length > 0, "lambda manifest should list functions");

  // The image-optimization function bundles the sharp native binary.
  const imageFn = functions.find((f) => f.entrypoint.includes("image-optimization-function"));
  if (imageFn) {
    ok(imageFn.nativeModules.length > 0, "image-optimization lambda should carry sharp .node files");
    for (const native of imageFn.nativeModules) {
      ok(
        existsSync(join(result.outputDir, "lambda", native)),
        `lambda native file exists: ${native}`,
      );
    }
  }

  const invoice = manifest.routes["/api/invoice"];
  ok(invoice, "manifest should record /api/invoice");
  equal(invoice.target, "lambda");
  const invoiceFn = functions.find((f) => f.entrypoint === invoice.entrypoint);
  ok(invoiceFn, "lambda function should match the invoice route entrypoint");
  ok(invoiceFn.files.length >= 4, "invoice lambda should include the route + webpack runtime + chunks");
  ok(
    invoiceFn.files.some((f) => f.endsWith("webpack-runtime.js")),
    "invoice lambda should include webpack-runtime.js",
  );
  ok(
    invoiceFn.files.some((f) => f.includes("node_modules/next")),
    "invoice lambda should include the Next.js runtime",
  );
});
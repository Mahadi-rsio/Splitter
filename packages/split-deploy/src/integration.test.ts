/**
 * Integration test: runs a real OpenNext build on examples/next-app,
 * then runs the split-deploy analyze and build pipeline.
 *
 * Requires: npm install + npx open-next build to succeed in the example app.
 * Skip with: SKIP_INTEGRATION=1
 */
import { equal, ok } from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

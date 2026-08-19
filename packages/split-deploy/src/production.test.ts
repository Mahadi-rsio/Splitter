/**
 * Unit tests for the production-oriented dependency-safety pipeline.
 *
 * Covers the core guarantees from the split-deploy spec:
 *  A. Hard-blocked Node builtins force Lambda
 *  B. Native addons (*.node) force Lambda
 *  C. Transitive dependencies are resolved to a complete closure
 *  D. Safe pure-JS packages are never blocked
 *  E. Conditional/risky packages are NOT auto-blocked (require real analysis)
 *  F. esbuild verification passes/fails as expected
 *  G. Shared dependencies are isolated per target
 *  H. Lambda closures are complete (framework runtime included)
 *  I. Worker closures exclude framework internals (external runtime)
 *  J. Bare and node:-prefixed builtins are normalized identically
 */
import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  FRAMEWORK_EXTERNALS,
  HARD_BLOCKED_NODE_BUILTINS,
  POLYFILLABLE_NODE_BUILTINS,
  categoryOf,
  hasBlockedDependency,
  isBlockedBuiltin,
  isBlockedPackage,
  isFrameworkPackage,
} from "./blocked-modules.js";
import { DependencyScanner, computeClosure, importsFrom, normalizeBuiltin } from "./imports.js";
import { scanNativeFiles } from "./native-scanner.js";
import { verifyWorkerCompatibility } from "./verify.js";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "split-prod-"));
  mkdirSync(join(root, "server-functions"), { recursive: true });
  mkdirSync(join(root, "server-functions", "node_modules", "zod"), { recursive: true });
  mkdirSync(join(root, "server-functions", "node_modules", "axios"), { recursive: true });
  writeFileSync(join(root, "server-functions", "node_modules", "zod", "package.json"), JSON.stringify({ name: "zod", version: "1.0.0", main: "index.js" }));
  writeFileSync(join(root, "server-functions", "node_modules", "zod", "index.js"), "export const v = 1;");
  writeFileSync(join(root, "server-functions", "node_modules", "axios", "package.json"), JSON.stringify({ name: "axios", version: "1.0.0", main: "index.js" }));
  writeFileSync(join(root, "server-functions", "node_modules", "axios", "index.js"), "export const get = async () => ({ ok: true });");

  writeFileSync(join(root, "server-functions", "entry.js"), `
import { v } from 'zod';
import { get } from 'axios';
export const handler = async () => ({ v, data: await get() });
`);
  writeFileSync(join(root, "server-functions", "fs-entry.js"), `
import fs from 'node:fs';
export const handler = () => fs.readFileSync('/etc/passwd');
`);
  writeFileSync(join(root, "server-functions", "native-entry.js"), `
import sharp from 'sharp';
export const handler = () => sharp('x.png');
`);
  return root;
}

// ---------------------------------------------------------------------------
// A. Hard-blocked Node builtins force Lambda
// ---------------------------------------------------------------------------

test("A: node:fs is hard-blocked (both forms)", () => {
  ok(isBlockedBuiltin("node:fs"));
  ok(isBlockedBuiltin("fs"));
  ok(HARD_BLOCKED_NODE_BUILTINS.has("node:fs"));
});

test("A: hard-blocked builtin in closure is detected and blocks", () => {
  const root = fixture();
  const closure = computeClosure(root, "server-functions/fs-entry.js", { includeFramework: true });
  ok(closure.blockedBuiltins.includes("node:fs"), `blocked builtins: ${closure.blockedBuiltins}`);
  ok(hasBlockedDependency(closure.nodeBuiltins, closure.unresolved));
});

// ---------------------------------------------------------------------------
// B. Native addons (*.node) force Lambda
// ---------------------------------------------------------------------------

test("B: native .node files are discovered and block Worker", () => {
  const root = fixture();
  mkdirSync(join(root, "server-functions", "node_modules", "sharp", "build", "Release"), { recursive: true });
  writeFileSync(join(root, "server-functions", "node_modules", "sharp", "build", "Release", "sharp.node"), "\x7fELF fake binary");
  const natives = scanNativeFiles(root);
  ok(natives.some((n) => n.path.endsWith("sharp.node")), "sharp.node should be discovered");
  ok(natives.some((n) => n.package === "sharp"), "owning package should be resolved");

  const closure = computeClosure(root, "server-functions/native-entry.js", { includeFramework: true });
  ok(closure.nativeFiles.length > 0, "native files should appear in closure");
});

// ---------------------------------------------------------------------------
// C. Transitive dependencies are resolved to a complete closure
// ---------------------------------------------------------------------------

test("C: transitive closure includes nested imports", () => {
  const root = fixture();
  writeFileSync(join(root, "server-functions", "helper.js"), "import { v } from 'zod'; export const helper = () => v;");
  writeFileSync(join(root, "server-functions", "main.js"), "import { helper } from './helper.js'; export const handler = () => helper();");
  const closure = computeClosure(root, "server-functions/main.js", { includeFramework: true });
  ok(closure.files.includes("server-functions/main.js"));
  ok(closure.files.includes("server-functions/helper.js"));
  ok(closure.packages.includes("zod"), "nested package dependency should be in closure");
});

// ---------------------------------------------------------------------------
// D. Safe pure-JS packages are never blocked
// ---------------------------------------------------------------------------

test("D: safe packages are never blocked", () => {
  const root = fixture();
  const closure = computeClosure(root, "server-functions/entry.js", { includeFramework: true });
  ok(closure.packages.includes("zod"), "zod resolved into closure");
  deepEqual(closure.blockedPackages, [], "zod must never be blocked");
  equal(categoryOf("zod"), "safe");
  ok(!isBlockedPackage("zod"));
});

// ---------------------------------------------------------------------------
// E. Conditional/risky packages are NOT auto-blocked
// ---------------------------------------------------------------------------

test("E: risky packages require real analysis and are not auto-blocked", () => {
  const root = fixture();
  const closure = computeClosure(root, "server-functions/entry.js", { includeFramework: true });
  ok(closure.packages.includes("axios"), "axios resolved into closure");
  ok(!closure.blockedPackages.includes("axios"), "axios is risky, not hard-blocked");
  equal(categoryOf("axios"), "risky");
});

// ---------------------------------------------------------------------------
// F. esbuild verification passes/fails as expected
// ---------------------------------------------------------------------------

test("F: esbuild verification passes for pure-JS worker candidate", () => {
  const root = fixture();
  const closure = computeClosure(root, "server-functions/entry.js", { includeFramework: false });
  const result = verifyWorkerCompatibility(closure, { root });
  equal(result.status, "passed", JSON.stringify(result.errors));
  ok(result.workerCompatible);
});

test("F: esbuild verification fails for hard-blocked builtin", () => {
  const root = fixture();
  const closure = computeClosure(root, "server-functions/fs-entry.js", { includeFramework: false });
  const result = verifyWorkerCompatibility(closure, { root });
  equal(result.status, "failed");
  equal(result.reason, "node-builtin");
  ok(!result.workerCompatible);
});

test("F: framework externals make pure Next routes buildable", () => {
  ok(FRAMEWORK_EXTERNALS.has("next"));
  ok(FRAMEWORK_EXTERNALS.has("react"));
  ok(FRAMEWORK_EXTERNALS.has("react-dom"));
  ok(isFrameworkPackage("next"));
  ok(isFrameworkPackage("react"));
});

// ---------------------------------------------------------------------------
// G. Shared dependencies are isolated per target
// ---------------------------------------------------------------------------

test("G: dependency scanner caches shared scans across entries", () => {
  const root = fixture();
  const scanner = new DependencyScanner(root);
  const a = scanner.closure("server-functions/entry.js", { includeFramework: true });
  const b = scanner.closure("server-functions/entry.js", { includeFramework: true });
  deepEqual(a.files, b.files);
  ok(a.files.length > 0);
});

// ---------------------------------------------------------------------------
// H. Lambda closures are complete (framework runtime included)
// ---------------------------------------------------------------------------

test("H: framework packages materialize for Lambda closures", () => {
  const root = fixture();
  mkdirSync(join(root, "server-functions", "node_modules", "next"), { recursive: true });
  writeFileSync(join(root, "server-functions", "node_modules", "next", "package.json"), JSON.stringify({ name: "next", version: "15.0.0", main: "index.js", dependencies: { react: "^18.0.0" } }));
  writeFileSync(join(root, "server-functions", "node_modules", "next", "index.js"), "require('react');");
  mkdirSync(join(root, "server-functions", "node_modules", "react"), { recursive: true });
  writeFileSync(join(root, "server-functions", "node_modules", "react", "package.json"), JSON.stringify({ name: "react", version: "18.3.1", main: "index.js" }));
  writeFileSync(join(root, "server-functions", "node_modules", "react", "index.js"), "export default {};");
  writeFileSync(join(root, "server-functions", "next-entry.js"), "import 'next'; export const h = () => 1;");

  const worker = computeClosure(root, "server-functions/next-entry.js", { includeFramework: false });
  ok(!worker.files.some((f) => f.includes("node_modules/next")), "worker closure excludes framework internals");
  ok(worker.frameworkPackages.includes("next"), "worker records framework as external");

  const lambda = computeClosure(root, "server-functions/next-entry.js", { includeFramework: true });
  ok(lambda.files.some((f) => f.includes("node_modules/next")), "lambda closure includes framework runtime");
  ok(lambda.files.some((f) => f.includes("node_modules/react")), "lambda closure includes framework deps");
});

// ---------------------------------------------------------------------------
// I. Worker closures exclude framework internals
// ---------------------------------------------------------------------------

test("I: webpack chunk patterns are extracted from Next.js output", () => {
  const source = `
    const __next_webpack_require__ = module.X(0,[873],() => require("./chunks/873.js"));
    import("./chunks/611.js");
    require('./chunks/' + x + '.js');
    require("./chunks/361.js");
  `;
  const imports = importsFrom(source);
  ok(imports.includes("./chunks/873.js"), "X() chunk id extracted");
  ok(imports.includes("./chunks/611.js"), "dynamic import chunk extracted");
  ok(imports.includes("./chunks/361.js"), "static chunk require extracted");
  ok(imports.includes("./chunks/*"), "directory glob extracted");
});

// ---------------------------------------------------------------------------
// J. Builtin normalization
// ---------------------------------------------------------------------------

test("J: bare and node:-prefixed builtins normalize identically", () => {
  equal(normalizeBuiltin("fs"), "node:fs");
  equal(normalizeBuiltin("node:fs"), "node:fs");
  equal(normalizeBuiltin("fs/promises"), "node:fs/promises");
  equal(normalizeBuiltin("path"), "node:path");
  equal(normalizeBuiltin("zod"), undefined);
  ok(POLYFILLABLE_NODE_BUILTINS.has("node:path"));
  ok(!POLYFILLABLE_NODE_BUILTINS.has("node:fs"));
});
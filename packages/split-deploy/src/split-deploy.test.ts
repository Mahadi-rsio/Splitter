import { deepEqual, equal, match, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyzeOpenNext } from "./analyze.js";
import { classifyRoute } from "./classify.js";
import { copySplitArtifacts } from "./copy.js";
import { scanJavaScriptDependencies } from "./imports.js";
import { readOpenNextBuild } from "./reader.js";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "split-deploy-"));
  writeFileSync(
    join(root, "routes-manifest.json"),
    JSON.stringify({
      staticRoutes: [{ page: "/" }],
      dynamicRoutes: [{ page: "/blog/[slug]", entry: "server-functions/default.js" }],
      routes: [
        {
          path: "/api/hello",
          type: "api",
          runtime: "nodejs",
          entry: "server-functions/default.js",
        },
        {
          path: "/edge",
          type: "dynamic",
          runtime: "edge",
          entry: "server-functions/edge.js",
        },
      ],
    }),
  );
  writeFileSync(join(root, "middleware-manifest.json"), JSON.stringify({ middleware: { "/(.*)": { runtime: "edge" } } }));
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(join(root, "static"), { recursive: true });
  mkdirSync(join(root, "server-functions"), { recursive: true });
  writeFileSync(join(root, "assets", "index.html"), "<html />");
  writeFileSync(join(root, "static", "chunk.js"), "console.log('cdn')");
  writeFileSync(join(root, "worker.js"), "import './worker-helper.js';");
  writeFileSync(join(root, "worker-helper.js"), "export const edge = true;");
  writeFileSync(join(root, "server-functions", "default.js"), "import './node-helper.js';");
  writeFileSync(join(root, "server-functions", "node-helper.js"), "import fs from 'node:fs'; export default fs;");
  writeFileSync(join(root, "server-functions", "edge.js"), "export default () => 'edge';");
  return root;
}

test("reads OpenNext conventions and identifies entries", () => {
  const root = fixture();
  const build = readOpenNextBuild(root);
  ok(build.manifests.some((manifest) => manifest.file === "routes-manifest.json"));
  deepEqual(build.assetFiles, ["assets/index.html", "static/chunk.js"]);
  deepEqual(build.workerEntries, ["worker.js"]);
  deepEqual(build.lambdaEntries, [
    "server-functions/default.js",
    "server-functions/node-helper.js",
  ]);
});

test("scans relative imports and records Node builtins", () => {
  const root = fixture();
  const scan = scanJavaScriptDependencies(root, "server-functions/default.js");
  deepEqual(scan.files, ["server-functions/default.js", "server-functions/node-helper.js"]);
  deepEqual(scan.nodeBuiltins, ["node:fs"]);
  equal(scan.externalImports.length, 0);
});

test("classifies static, edge, and node routes", () => {
  equal(classifyRoute({ path: "/", kind: "static", runtime: "unknown" }), "cdn");
  equal(classifyRoute({ path: "/edge", kind: "dynamic", runtime: "edge" }), "worker");
  equal(
    classifyRoute(
      { path: "/api", kind: "api", runtime: "unknown" },
      { entry: "x.js", files: ["x.js"], externalImports: [], nodeBuiltins: ["node:fs"] },
    ),
    "lambda",
  );
});

test("analyzes and copies a split build", () => {
  const root = fixture();
  const analysis = analyzeOpenNext(root);
  const output = join(root, "..", "split-output");
  const result = copySplitArtifacts(analysis, output);

  equal(analysis.routes.find((route) => route.path === "/")?.target, "cdn");
  equal(analysis.routes.find((route) => route.path === "/edge")?.target, "worker");
  equal(analysis.routes.find((route) => route.path === "/api/hello")?.target, "lambda");
  ok(result.copied.cdn.includes("assets/index.html"));
  ok(result.copied.worker.includes("worker-helper.js"));
  ok(result.copied.lambda.includes("server-functions/node-helper.js"));
  match(readFileSync(result.manifestPath, "utf8"), /"routes"/);
});
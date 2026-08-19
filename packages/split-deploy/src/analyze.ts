import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyRoute } from "./classify.js";
import { scanJavaScriptDependencies } from "./imports.js";
import { readOpenNextBuild } from "./reader.js";
import { detectRoutes } from "./routes.js";
import type {
  ArtifactTarget,
  BuildAnalysis,
  ClassifiedRoute,
  DependencyScan,
  RouteDefinition,
} from "./types.js";

const TARGETS: ArtifactTarget[] = ["cdn", "worker", "lambda"];

function addUnique(target: Set<string>, values: string[]): void {
  for (const value of values) target.add(value);
}

function scanIfPresent(
  root: string,
  entry: string,
  warnings: string[],
): DependencyScan | undefined {
  if (!existsSync(join(root, entry))) {
    warnings.push(`Entry does not exist: ${entry}`);
    return undefined;
  }
  return scanJavaScriptDependencies(root, entry);
}

/**
 * Produces a deterministic split plan from an OpenNext build output.
 * No files are written — this is a pure analysis step.
 */
export function analyzeOpenNext(inputDir = ".open-next"): BuildAnalysis {
  const root = resolve(inputDir);
  const build = readOpenNextBuild(root);
  const warnings: string[] = [];
  const routes = detectRoutes(build.manifests, build);
  const files: Record<ArtifactTarget, Set<string>> = {
    cdn: new Set(build.assetFiles),
    worker: new Set(),
    lambda: new Set(),
  };
  const entries: Record<ArtifactTarget, Set<string>> = {
    cdn: new Set(),
    worker: new Set(),
    lambda: new Set(),
  };
  const dependencyScans: DependencyScan[] = [];
  const classifiedRoutes: ClassifiedRoute[] = [];

  for (const route of routes) {
    let scan: DependencyScan | undefined;
    if (route.entry) {
      scan = scanIfPresent(root, route.entry, warnings);
    }
    const target = classifyRoute(route, scan);
    classifiedRoutes.push({ ...route, target, dependencyScan: scan });
    if (scan) {
      dependencyScans.push(scan);
      // CDN routes are static/prerendered — their server-side entry files
      // belong to Lambda (the SSR fallback), not to the CDN artifact.
      if (target !== "cdn") {
        addUnique(files[target], scan.files);
        if (route.entry) entries[target].add(route.entry);
      }
    }
  }

  for (const entry of build.workerEntries) {
    const scan = scanIfPresent(root, entry, warnings);
    if (!scan) continue;
    entries.worker.add(entry);
    dependencyScans.push(scan);
    addUnique(files.worker, scan.files);
  }

  for (const entry of build.lambdaEntries) {
    if (entries.worker.has(entry)) continue;
    const scan = scanIfPresent(root, entry, warnings);
    if (!scan) continue;
    entries.lambda.add(entry);
    dependencyScans.push(scan);
    addUnique(files.lambda, scan.files);
  }

  // Also collect server function bundles as whole directories for Lambda
  for (const fn of build.serverFunctions) {
    if (!entries.lambda.has(fn.entrypoint) && !entries.worker.has(fn.entrypoint)) {
      entries.lambda.add(fn.entrypoint);
      addUnique(files.lambda, fn.files);
    }
  }

  if (build.assetFiles.length === 0) {
    warnings.push("No CDN asset directory found (expected assets/, static/, or public/).");
  }

  return {
    inputDir: root,
    routes: classifiedRoutes,
    assets: [...build.assetFiles].sort(),
    entries: Object.fromEntries(
      TARGETS.map((target) => [target, [...entries[target]].sort()]),
    ) as Record<ArtifactTarget, string[]>,
    files: Object.fromEntries(
      TARGETS.map((target) => [target, [...files[target]].sort()]),
    ) as Record<ArtifactTarget, string[]>,
    dependencyScans,
    warnings: [...new Set(warnings)],
  };
}

export function summarizeAnalysis(analysis: BuildAnalysis): string {
  const lines: string[] = [];

  lines.push("Routes\n");

  for (const target of TARGETS) {
    const targetRoutes = analysis.routes.filter((r) => r.target === target);
    if (targetRoutes.length === 0) continue;
    lines.push(`  ${target.toUpperCase()}`);
    for (const route of targetRoutes) {
      const deps = route.dependencyScan;
      let suffix = "";
      if (deps && deps.nodeBuiltins.length > 0) {
        suffix = `  (${deps.nodeBuiltins.join(", ")})`;
      }
      lines.push(`    ${route.path}${suffix}`);
    }
    lines.push("");
  }

  if (analysis.warnings.length > 0) {
    lines.push("Warnings:");
    for (const w of analysis.warnings) lines.push(`  - ${w}`);
    lines.push("");
  }

  return lines.join("\n");
}

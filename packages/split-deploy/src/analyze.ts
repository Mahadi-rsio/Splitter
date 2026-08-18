import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyRoute } from "./classify.js";
import { scanJavaScriptDependencies } from "./imports.js";
import { readOpenNextBuild } from "./reader.js";
import { detectRoutes } from "./routes.js";
import type {
  ArtifactTarget,
  BuildAnalysis,
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

function routeWithScan(
  root: string,
  route: RouteDefinition,
  warnings: string[],
): { route: RouteDefinition; scan?: DependencyScan } {
  const scan = route.entry ? scanIfPresent(root, route.entry, warnings) : undefined;
  return { route, scan };
}

/**
 * Produces a deterministic split plan. No files are written by this function.
 */
export function analyzeOpenNext(inputDir = ".open-next"): BuildAnalysis {
  const root = resolve(inputDir);
  const build = readOpenNextBuild(root);
  const warnings: string[] = [];
  const routes = detectRoutes(build.manifests);
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
  const classifiedRoutes = [];

  for (const route of routes) {
    const result = routeWithScan(root, route, warnings);
    const target = classifyRoute(route, result.scan);
    classifiedRoutes.push({ ...route, target, dependencyScan: result.scan });
    if (result.scan) {
      dependencyScans.push(result.scan);
      addUnique(files[target], result.scan.files);
      if (route.entry) entries[target].add(route.entry);
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
    const scan = scanIfPresent(root, entry, warnings);
    if (!scan) continue;
    entries.lambda.add(entry);
    dependencyScans.push(scan);
    addUnique(files.lambda, scan.files);
  }

  if (!build.manifests.some(({ file }) => file.endsWith("routes-manifest.json"))) {
    warnings.push("No routes-manifest.json found; only conventional OpenNext entries were classified.");
  }
  if (build.assetFiles.length === 0) {
    warnings.push("No CDN asset directory found (expected assets/, static/, or public/).");
  }
  if (build.workerEntries.length === 0) {
    warnings.push("No worker entry found (expected worker.js, middleware.js, or middleware/).");
  }
  if (build.lambdaEntries.length === 0) {
    warnings.push("No server function entry found under server-functions/.");
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
  const lines = [
    `OpenNext build: ${analysis.inputDir}`,
    `Routes: ${analysis.routes.length}`,
    `CDN files: ${analysis.files.cdn.length}`,
    `Worker files: ${analysis.files.worker.length}`,
    `Lambda files: ${analysis.files.lambda.length}`,
    "",
    "Routes by target:",
  ];
  for (const target of TARGETS) {
    const targetRoutes = analysis.routes.filter((route) => route.target === target);
    lines.push(`  ${target}: ${targetRoutes.length}`);
    for (const route of targetRoutes) {
      lines.push(`    ${route.path} (${route.kind}, ${route.runtime})`);
    }
  }
  if (analysis.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of analysis.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join("\n");
}
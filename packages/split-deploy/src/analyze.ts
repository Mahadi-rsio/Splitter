import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageNameOf } from "./blocked-modules.js";
import { classifyRouteWithEvidence } from "./classify.js";
import { DependencyScanner } from "./imports.js";
import { scanNativeFiles } from "./native-scanner.js";
import { readOpenNextBuild } from "./reader.js";
import { detectRoutes } from "./routes.js";
import { verifyWorkerCompatibility } from "./verify.js";
import type {
  ArtifactTarget,
  BuildAnalysis,
  ClassifiedRoute,
  RouteClosure,
  RouteDefinition,
  WorkerVerification,
} from "./types.js";

const TARGETS: ArtifactTarget[] = ["cdn", "worker", "lambda"];

function addUnique(target: Set<string>, values: string[]): void {
  for (const value of values) target.add(value);
}

/**
 * Produces a deterministic split plan from an OpenNext build output.
 * No files are written — this is a pure analysis step.
 *
 * For every server route the pipeline:
 *   1. computes the complete dependency closure
 *   2. checks static signals (hard-blocked builtins, native binaries, packages)
 *   3. runs esbuild Worker verification on Worker candidates
 *   4. records the target + reason + diagnostics
 *
 * Closures and verifications are cached so shared dependencies are only
 * scanned once.
 */
export function analyzeOpenNext(inputDir = ".open-next"): BuildAnalysis {
  const root = resolve(inputDir);
  const build = readOpenNextBuild(root);
  const scanner = new DependencyScanner(root);
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

  const closures: RouteClosure[] = [];
  const classifiedRoutes: ClassifiedRoute[] = [];
  const nativeFiles = scanNativeFiles(root);
  const verificationCache = new Map<string, WorkerVerification>();

  const verify = (entry: string, closure: RouteClosure): WorkerVerification => {
    const cached = verificationCache.get(entry);
    if (cached) return cached;
    const verification = verifyWorkerCompatibility(closure, { root });
    verificationCache.set(entry, verification);
    return verification;
  };

  const closureFor = (entry: string, includeFramework: boolean): RouteClosure => {
    if (!existsSync(join(root, entry))) {
      warnings.push(`Entry does not exist: ${entry}`);
    }
    const closure = scanner.closure(entry, { includeFramework });
    closures.push(closure);
    return closure;
  };

  for (const route of routes) {
    const result = classifyRoute(
      route,
      scanner,
      verify,
      closureFor,
      warnings,
    );
    const classified: ClassifiedRoute = {
      ...route,
      target: result.target,
      reason: result.reason,
      closure: result.closure,
      verification: result.verification,
      diagnostics: result.diagnostics,
    };
    classifiedRoutes.push(classified);

    if (result.closure && result.target !== "cdn") {
      addUnique(files[result.target], result.closure.files);
      if (route.entry && result.target === "worker") {
        entries[result.target].add(route.entry);
      }
    }
  }

  // Platform worker entries (worker.js / middleware) — verified but cannot be
  // promoted, so failures become warnings.
  for (const entry of build.workerEntries) {
    if (!existsSync(join(root, entry))) {
      warnings.push(`Worker entry does not exist: ${entry}`);
      continue;
    }
    const closure = closureFor(entry, false);
    addUnique(files.worker, closure.files);
    entries.worker.add(entry);
    const verification = verify(entry, closure);
    if (verification.status === "failed") {
      warnings.push(
        `Worker entry ${entry} failed esbuild verification (${verification.reason}) — deploy on a Worker runtime with the required polyfills.`,
      );
    }
  }

  // Server function bundles (e.g. server-functions/default/index.mjs) — Lambda.
  // These handlers dynamically load the .next tree at runtime, so the full
  // server-function directory becomes the Lambda artifact.
  for (const fn of build.serverFunctions) {
    const entry = fn.entrypoint;
    if (entries.worker.has(entry)) continue;
    if (!existsSync(join(root, entry))) {
      warnings.push(`Lambda entry does not exist: ${entry}`);
      continue;
    }
    addUnique(files.lambda, fn.files);
    entries.lambda.add(entry);
    const nativeFiles = fn.files
      .filter((f) => f.endsWith(".node"))
      .map((path) => ({
        path,
        package: packageNameOf(path.includes("/node_modules/")
          ? path.slice(path.indexOf("/node_modules/") + "/node_modules/".length)
          : path),
        reason: "native-addon" as const,
      }));
    closures.push({
      entry,
      files: fn.files,
      packages: [],
      frameworkPackages: [],
      nodeBuiltins: [],
      blockedBuiltins: [],
      blockedPackages: [],
      nativeFiles,
      unresolved: [],
      chain: [],
    });
  }

  if (build.assetFiles.length === 0) {
    warnings.push(
      "No CDN asset directory found (expected assets/, static/, or public/).",
    );
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
    dependencyScans: closures.map((c) => ({
      entry: c.entry,
      files: c.files,
      externalImports: c.unresolved,
      nodeBuiltins: c.nodeBuiltins,
    })),
    closures,
    nativeFiles,
    warnings: [...new Set(warnings)],
  };
}

function classifyRoute(
  route: RouteDefinition,
  scanner: DependencyScanner,
  verify: (entry: string, closure: RouteClosure) => WorkerVerification,
  closureFor: (entry: string, includeFramework: boolean) => RouteClosure,
  warnings: string[],
): {
  target: ArtifactTarget;
  reason: ClassifiedRoute["reason"];
  closure?: RouteClosure;
  verification?: WorkerVerification;
  diagnostics: string[];
} {
  if (
    (route.kind === "static" || route.kind === "prerendered") &&
    !route.entry
  ) {
    return { target: "cdn", reason: route.kind, diagnostics: [] };
  }

  if (route.runtime === "node") {
    const closure = route.entry ? closureFor(route.entry, true) : undefined;
    return {
      target: "lambda",
      reason: "explicit-node-runtime",
      closure,
      diagnostics: ["Route declares Node.js runtime — not Worker-compatible."],
    };
  }

  const workerClosure = route.entry ? closureFor(route.entry, false) : undefined;

  // Static incompatibility signals — no need to verify with esbuild.
  if (workerClosure) {
    if (workerClosure.blockedBuiltins.length > 0) {
      return {
        target: "lambda",
        reason: "node-builtin",
        closure: closureFor(route.entry!, true),
        diagnostics: [
          `Worker-incompatible Node builtin(s): ${workerClosure.blockedBuiltins.join(", ")}`,
          chainMessage(workerClosure),
        ],
      };
    }
    if (workerClosure.nativeFiles.length > 0) {
      return {
        target: "lambda",
        reason: "native-addon",
        closure: closureFor(route.entry!, true),
        diagnostics: [
          `Native addon(s) in closure: ${workerClosure.nativeFiles.map((n) => n.path).join(", ")}`,
          chainMessage(workerClosure),
        ],
      };
    }
    if (workerClosure.blockedPackages.length > 0) {
      return {
        target: "lambda",
        reason: "blocked-package",
        closure: closureFor(route.entry!, true),
        diagnostics: [
          `Hard-blocked package(s) in closure: ${workerClosure.blockedPackages.join(", ")}`,
          chainMessage(workerClosure),
        ],
      };
    }
  }

  const declaredEdge = route.kind === "middleware" || route.runtime === "edge";

  // Worker candidate — verify with esbuild.
  if (workerClosure) {
    const verification = verify(route.entry!, workerClosure);
    if (verification.status === "failed") {
      return {
        target: "lambda",
        reason: verification.reason ?? "esbuild-failure",
        closure: closureFor(route.entry!, true),
        verification,
        diagnostics: [
          `esbuild Worker verification failed: ${verification.reason ?? "unknown"}`,
          ...verification.errors.slice(0, 5).map((e) => `  - ${e}`),
          chainMessage(workerClosure),
        ],
      };
    }
    return {
      target: "worker",
      reason: "none",
      closure: workerClosure,
      verification,
      diagnostics: [],
    };
  }

  if (declaredEdge) {
    return { target: "worker", reason: "edge-runtime", diagnostics: [] };
  }

  warnings.push(`Route ${route.path} has no entrypoint — cannot verify; promoting to Lambda.`);
  return {
    target: "lambda",
    reason: "unknown-runtime",
    diagnostics: [`Route ${route.path} has no entrypoint — cannot verify.`],
  };
}

function chainMessage(closure: RouteClosure): string {
  if (closure.chain.length === 0) return "";
  return `  dependency chain: ${closure.chain.join(" → ")}`;
}

export function summarizeAnalysis(analysis: BuildAnalysis): string {
  const lines: string[] = [];

  lines.push("Routes\n");

  for (const target of TARGETS) {
    const targetRoutes = analysis.routes.filter((r) => r.target === target);
    if (targetRoutes.length === 0) continue;
    lines.push(`  ${target.toUpperCase()}`);
    for (const route of targetRoutes) {
      let suffix = "";
      if (
        route.reason !== "none" &&
        route.reason !== "static" &&
        route.reason !== "prerendered"
      ) {
        suffix = `  (${route.reason})`;
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
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  ArtifactTarget,
  BuildAnalysis,
  CopyResult,
  RouteClosure,
  SplitManifest,
  SplitOptions,
} from "./types.js";

const TARGETS: ArtifactTarget[] = ["cdn", "worker", "lambda"];

function generateBuildId(): string {
  return `build-${Date.now().toString(36)}`;
}

function slugify(path: string): string {
  return (
    path
      .replace(/^\//, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "root"
  );
}

function entryName(entry: string, existing: Set<string>): string {
  const parts = entry.split("/");
  let name = parts.length > 1 ? parts.slice(0, -1).join("-") : entry.replace(/\.\w+$/, "");
  // Collapse repeated separators from bracket paths etc.
  name = name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || entry;
  let candidate = name;
  let i = 2;
  while (existing.has(candidate)) {
    candidate = `${name}-${i}`;
    i += 1;
  }
  existing.add(candidate);
  return candidate;
}

function closureToManifest(closure: RouteClosure | undefined) {
  return {
    files: closure?.files ?? [],
    packages: closure?.packages ?? [],
    nodeBuiltins: closure?.nodeBuiltins ?? [],
    nativeModules: closure?.nativeFiles.map((n) => n.path) ?? [],
  };
}

/**
 * Copies analyzed artifacts into the split output directory structure.
 * Each target (cdn/worker/lambda) only gets the files it actually needs,
 * where worker/lambda routes receive their complete dependency closure.
 */
export function copySplitArtifacts(
  analysis: BuildAnalysis,
  options?: Partial<SplitOptions>,
): CopyResult {
  const tenantId = options?.tenantId ?? "local";
  const buildId = options?.buildId ?? generateBuildId();
  const baseOutput = resolve(options?.output ?? ".open-next-split");

  const useTenantPath = options?.tenantId || options?.buildId;
  const destination = useTenantPath
    ? join(baseOutput, "tenants", tenantId, buildId)
    : baseOutput;

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  const copied: Record<ArtifactTarget, string[]> = {
    cdn: [],
    worker: [],
    lambda: [],
  };

  for (const target of TARGETS) {
    const targetDir = join(destination, target);
    mkdirSync(targetDir, { recursive: true });
    for (const file of analysis.files[target]) {
      const source = join(analysis.inputDir, file);
      const output = join(targetDir, file);
      if (!existsSync(source)) continue;
      mkdirSync(dirname(output), { recursive: true });
      cpSync(source, output);
      copied[target].push(file);
    }
  }

  const diagnostics: string[] = [];
  for (const route of analysis.routes) {
    for (const d of route.diagnostics) {
      diagnostics.push(`${route.path}: ${d}`);
    }
  }
  for (const warning of analysis.warnings) {
    diagnostics.push(`WARN: ${warning}`);
  }

  const manifest: SplitManifest = {
    version: 1,
    buildId,
    tenantId,
    routes: {},
    cdn: { files: copied.cdn },
    worker: {
      entrypoints: analysis.entries.worker,
      files: copied.worker,
      externalRuntime: [],
    },
    lambda: { functions: {} },
    diagnostics,
  };

  const workerFramework = new Set<string>();
  const functionNames = new Set<string>();

  for (const route of analysis.routes) {
    manifest.routes[route.path] = {
      target: route.target,
      entrypoint: route.entry,
      dependencies: route.closure?.packages ?? route.closure?.files ?? [],
      reason: route.reason,
      dependencyClosure: closureToManifest(route.closure),
      verification: {
        workerCompatible:
          route.target === "worker" && (route.verification?.workerCompatible ?? true),
        method: route.verification?.method ?? (route.target === "worker" ? "esbuild" : "static"),
        status:
          route.verification?.status ??
          (route.target === "worker" ? "passed" : "skipped"),
        reason: route.reason !== "none" ? route.reason : undefined,
      },
    };
    if (route.closure) {
      for (const pkg of route.closure.frameworkPackages) {
        workerFramework.add(pkg);
      }
    }

    if (route.target === "lambda" && route.entry) {
      const name = slugify(route.path);
      let candidate = name;
      let i = 2;
      while (functionNames.has(candidate)) {
        candidate = `${name}-${i}`;
        i += 1;
      }
      functionNames.add(candidate);
      manifest.lambda.functions[candidate] = {
        entrypoint: route.entry,
        files: route.closure?.files ?? [],
        nodeBuiltins: route.closure?.nodeBuiltins ?? [],
        nativeModules: route.closure?.nativeFiles.map((n) => n.path) ?? [],
      };
    }
  }

  // Server-function bundles that are Lambda entries.
  for (const entry of analysis.entries.lambda) {
    const closure = analysis.closures.find(
      (c) => c.entry === entry && c.files.includes(entry),
    ) ?? analysis.closures.find((c) => c.entry === entry);
    const name = entryName(entry, functionNames);
    manifest.lambda.functions[name] = {
      entrypoint: entry,
      files: closure?.files ?? [entry],
      nodeBuiltins: closure?.nodeBuiltins ?? [],
      nativeModules: closure?.nativeFiles.map((n) => n.path) ?? [],
    };
  }

  // Worker runtime externals — the union of framework packages the worker
  // routes rely on (next, react, ...) that the Worker platform provides.
  manifest.worker.externalRuntime = [...workerFramework].sort();

  const manifestPath = join(destination, "manifest.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return { outputDir: destination, copied, manifestPath };
}
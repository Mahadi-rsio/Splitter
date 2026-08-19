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
  SplitManifest,
  SplitOptions,
} from "./types.js";

const TARGETS: ArtifactTarget[] = ["cdn", "worker", "lambda"];

function generateBuildId(): string {
  return `build-${Date.now().toString(36)}`;
}

/**
 * Copies analyzed artifacts into the split output directory structure.
 * Each target (cdn/worker/lambda) only gets the files it actually needs.
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

  // Build the manifest
  const manifest: SplitManifest = {
    version: 1,
    buildId,
    tenantId,
    routes: {},
    cdn: { files: copied.cdn },
    worker: { entrypoints: analysis.entries.worker, files: copied.worker },
    lambda: { functions: {} },
  };

  for (const route of analysis.routes) {
    manifest.routes[route.path] = {
      target: route.target,
      entrypoint: route.entry,
      dependencies: route.dependencyScan?.externalImports,
    };
  }

  // Group Lambda entries by function name
  for (const entry of analysis.entries.lambda) {
    const parts = entry.split("/");
    const name = parts.length > 1 ? parts.slice(0, -1).join("-") : entry.replace(/\.\w+$/, "");
    manifest.lambda.functions[name] = {
      entrypoint: entry,
      files: analysis.dependencyScans
        .find((s) => s.entry === entry)?.files ?? [],
    };
  }

  const manifestPath = join(destination, "manifest.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return { outputDir: destination, copied, manifestPath };
}

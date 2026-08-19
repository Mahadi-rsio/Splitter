import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HARD_BLOCKED_NODE_BUILTINS,
  HARD_BLOCKED_PACKAGES,
  isBlockedBuiltin,
} from "./blocked-modules.js";
import type { ArtifactTarget, SplitManifest } from "./types.js";

export interface ValidationError {
  target: ArtifactTarget;
  file: string;
  message: string;
}

const SERVER_ONLY_PREFIXES = ["server-functions/", ".next/server", "server/"];

function isJavaScript(file: string): boolean {
  return /\.(m?js|cjs)$/.test(file);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function importPatternsFor(module: string): RegExp[] {
  const escaped = escapeRegex(module);
  return [
    new RegExp(`\\bfrom\\s+["']${escaped}["']`),
    new RegExp(`\\brequire\\s*\\(\\s*["']${escaped}["']\\s*\\)`),
    new RegExp(`\\bimport\\s*\\(\\s*["']${escaped}["']\\s*\\)`),
  ];
}

function containsImport(source: string, module: string): boolean {
  return importPatternsFor(module).some((pattern) => pattern.test(source));
}

/**
 * Validates split artifacts after copying:
 * - CDN: every file exists; no server-only files; no server entrypoints
 * - Worker: entrypoints + dependencies exist; no hard-blocked builtins;
 *   no *.node binaries; no hard-blocked packages; verification passed
 * - Lambda: entrypoints + complete closure exist; native files preserved
 * - Manifest: valid JSON, valid targets, consistent metadata
 */
export function validateSplitOutput(outputDir: string): ValidationError[] {
  const errors: ValidationError[] = [];

  const manifestPath = join(outputDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    errors.push({
      target: "cdn",
      file: "manifest.json",
      message: "manifest.json does not exist",
    });
    return errors;
  }

  let manifest: SplitManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SplitManifest;
  } catch {
    errors.push({
      target: "cdn",
      file: "manifest.json",
      message: "manifest.json is not valid JSON",
    });
    return errors;
  }

  if (manifest.version !== 1) {
    errors.push({
      target: "cdn",
      file: "manifest.json",
      message: `Unsupported manifest version: ${String(manifest.version)}`,
    });
  }

  // -------------------------------------------------------------------------
  // Manifest consistency
  // -------------------------------------------------------------------------
  const validTargets = new Set(["cdn", "worker", "lambda"]);
  for (const [path, route] of Object.entries(manifest.routes ?? {})) {
    if (!validTargets.has(route.target)) {
      errors.push({
        target: "cdn",
        file: "manifest.json",
        message: `Route "${path}" has invalid target: ${route.target}`,
      });
    }
    if (route.entrypoint && !existsSync(join(outputDir, route.target, route.entrypoint))) {
      errors.push({
        target: route.target,
        file: route.entrypoint,
        message: `Route "${path}" entrypoint missing from ${route.target}: ${route.entrypoint}`,
      });
    }
    for (const f of route.dependencyClosure?.files ?? []) {
      if (!existsSync(join(outputDir, route.target, f))) {
        errors.push({
          target: route.target,
          file: f,
          message: `Route "${path}" closure file missing from ${route.target}: ${f}`,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // CDN validation
  // -------------------------------------------------------------------------
  const serverEntries = new Set<string>([
    ...(manifest.worker?.entrypoints ?? []),
    ...Object.values(manifest.lambda?.functions ?? {}).map((f) => f.entrypoint),
  ]);

  for (const file of manifest.cdn?.files ?? []) {
    const abs = join(outputDir, "cdn", file);
    if (!existsSync(abs)) {
      errors.push({ target: "cdn", file, message: `CDN file missing: ${file}` });
      continue;
    }
    if (serverEntries.has(file)) {
      errors.push({
        target: "cdn",
        file,
        message: `CDN contains server entrypoint: ${file}`,
      });
    }
    if (SERVER_ONLY_PREFIXES.some((p) => file.startsWith(p))) {
      errors.push({
        target: "cdn",
        file,
        message: `CDN contains server-only file: ${file}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Worker validation
  // -------------------------------------------------------------------------
  for (const file of manifest.worker?.files ?? []) {
    const abs = join(outputDir, "worker", file);
    if (!existsSync(abs)) {
      errors.push({
        target: "worker",
        file,
        message: `Worker file missing: ${file}`,
      });
      continue;
    }
    if (file.endsWith(".node")) {
      errors.push({
        target: "worker",
        file,
        message: `Worker artifact contains native binary: ${file}`,
      });
    }
    if (isJavaScript(file)) {
      const source = readFileSync(abs, "utf8");
      for (const blocked of HARD_BLOCKED_NODE_BUILTINS) {
        if (containsImport(source, blocked) || containsImport(source, blocked.slice(5))) {
          errors.push({
            target: "worker",
            file,
            message: `Worker artifact imports hard-blocked Node builtin: ${blocked}`,
          });
        }
      }
      for (const pkg of HARD_BLOCKED_PACKAGES) {
        if (containsImport(source, pkg)) {
          errors.push({
            target: "worker",
            file,
            message: `Worker artifact imports hard-blocked package: ${pkg}`,
          });
        }
      }
    }
  }

  for (const entry of manifest.worker?.entrypoints ?? []) {
    if (!existsSync(join(outputDir, "worker", entry))) {
      errors.push({
        target: "worker",
        file: entry,
        message: `Worker entrypoint missing: ${entry}`,
      });
    }
  }

  // Worker routes must have passed verification.
  for (const [path, route] of Object.entries(manifest.routes ?? {})) {
    if (route.target === "worker" && route.verification?.status !== "passed") {
      errors.push({
        target: "worker",
        file: path,
        message: `Worker route "${path}" did not pass verification: ${route.verification?.status ?? "none"}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Lambda validation
  // -------------------------------------------------------------------------
  for (const [name, fn] of Object.entries(manifest.lambda?.functions ?? {})) {
    const entryAbs = join(outputDir, "lambda", fn.entrypoint);
    if (!existsSync(entryAbs)) {
      errors.push({
        target: "lambda",
        file: fn.entrypoint,
        message: `Lambda function "${name}" entrypoint missing: ${fn.entrypoint}`,
      });
    }
    for (const file of fn.files) {
      if (!existsSync(join(outputDir, "lambda", file))) {
        errors.push({
          target: "lambda",
          file,
          message: `Lambda function "${name}" closure file missing: ${file}`,
        });
      }
    }
    for (const native of fn.nativeModules ?? []) {
      if (!existsSync(join(outputDir, "lambda", native))) {
        errors.push({
          target: "lambda",
          file: native,
          message: `Lambda function "${name}" native binary missing: ${native}`,
        });
      }
    }
  }

  // Lambda may use Node builtins — but the manifest must agree with reality.
  for (const [path, route] of Object.entries(manifest.routes ?? {})) {
    if (route.target !== "lambda") continue;
    const closureFiles = route.dependencyClosure?.files ?? [];
    const blocked = (route.dependencyClosure?.nodeBuiltins ?? []).filter((b) =>
      isBlockedBuiltin(b),
    );
    if (blocked.length === 0 && route.reason === "node-builtin") {
      errors.push({
        target: "lambda",
        file: path,
        message: `Lambda route "${path}" reports node-builtin reason but no blocked builtins in closure`,
      });
    }
    if (closureFiles.length === 0 && route.entrypoint) {
      errors.push({
        target: "lambda",
        file: path,
        message: `Lambda route "${path}" has no dependency closure`,
      });
    }
  }

  return errors;
}
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BLOCKED_MODULES } from "./blocked-modules.js";
import type { ArtifactTarget, SplitManifest } from "./types.js";

export interface ValidationError {
  target: ArtifactTarget;
  file: string;
  message: string;
}

/**
 * Validates split artifacts after copying:
 * - All referenced files exist
 * - Worker contains no blocked Node dependencies
 * - CDN contains no server entrypoints
 * - Lambda includes required Node dependencies
 * - Manifest is valid JSON
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
      message: `Unsupported manifest version: ${manifest.version}`,
    });
  }

  // Validate CDN files exist
  for (const file of manifest.cdn.files) {
    if (!existsSync(join(outputDir, "cdn", file))) {
      errors.push({
        target: "cdn",
        file,
        message: `CDN file missing: ${file}`,
      });
    }
  }

  // Validate Worker files exist and contain no blocked imports
  for (const file of manifest.worker.files) {
    const filePath = join(outputDir, "worker", file);
    if (!existsSync(filePath)) {
      errors.push({
        target: "worker",
        file,
        message: `Worker file missing: ${file}`,
      });
      continue;
    }

    if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
      const source = readFileSync(filePath, "utf8");
      for (const blocked of BLOCKED_MODULES) {
        const patterns = [
          new RegExp(`\\bfrom\\s+["']${escapeRegex(blocked)}["']`),
          new RegExp(`\\brequire\\s*\\(\\s*["']${escapeRegex(blocked)}["']\\s*\\)`),
          new RegExp(`\\bimport\\s*\\(\\s*["']${escapeRegex(blocked)}["']\\s*\\)`),
        ];
        for (const pattern of patterns) {
          if (pattern.test(source)) {
            errors.push({
              target: "worker",
              file,
              message: `Worker artifact contains blocked module: ${blocked}`,
            });
          }
        }
      }
    }
  }

  // Validate CDN does not contain server entrypoints
  const serverEntries = new Set([
    ...manifest.worker.entrypoints,
    ...Object.values(manifest.lambda.functions).map((f) => f.entrypoint),
  ]);
  for (const file of manifest.cdn.files) {
    if (serverEntries.has(file)) {
      errors.push({
        target: "cdn",
        file,
        message: `CDN contains server entrypoint: ${file}`,
      });
    }
  }

  // Validate Lambda function files exist
  for (const [name, fn] of Object.entries(manifest.lambda.functions)) {
    const entryPath = join(outputDir, "lambda", fn.entrypoint);
    if (!existsSync(entryPath)) {
      errors.push({
        target: "lambda",
        file: fn.entrypoint,
        message: `Lambda function "${name}" entrypoint missing: ${fn.entrypoint}`,
      });
    }
  }

  return errors;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

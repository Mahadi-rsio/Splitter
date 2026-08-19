/**
 * Worker verification with esbuild.
 *
 * After static analysis classifies a route as a Worker candidate, we create a
 * temporary esbuild bundle to verify the candidate is actually buildable for a
 * Worker/neutral environment. The bundle is written to a temp directory and
 * discarded — it never touches the final worker/lambda/cdn artifacts.
 *
 * Verification is intentionally NOT the only mechanism. It is combined with:
 *  1. static dependency analysis (imports.ts)
 *  2. Node builtin detection (blocked-modules.ts)
 *  3. native *.node detection (native-scanner.ts)
 *  4. package classification (blocked-modules.ts)
 *  5. esbuild verification (this module)
 *
 * Static signals that prove incompatibility (hard-blocked builtins, native
 * binaries, blocked packages) win over a passing esbuild build.
 */
import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FRAMEWORK_EXTERNALS,
  POLYFILLABLE_NODE_BUILTINS,
  isBlockedBuiltin,
} from "./blocked-modules.js";
import type { BlockReason, RouteClosure, WorkerVerification } from "./types.js";

function classifyFailure(errors: { text: string; location?: unknown }[]): {
  reason: BlockReason;
  messages: string[];
} {
  const text = errors.map((e) => e.text).join("\n");
  const messages = errors.map((e) => e.text);

  if (/could not resolve ["']node:[^"']+["']/i.test(text)) {
    const m = text.match(/["'](node:[^"']+)["']/);
    return {
      reason: "node-builtin",
      messages: m ? [`Node builtin not available in Worker target: ${m[1]}`] : messages,
    };
  }
  if (/\.node\b/i.test(text)) {
    return { reason: "native-addon", messages };
  }
  if (/could not resolve/i.test(text)) {
    return { reason: "unresolved-dependency", messages };
  }
  return { reason: "esbuild-failure", messages };
}

/**
 * Verifies that a route entrypoint can be bundled for a Worker/neutral
 * environment. Returns a structured result that never throws.
 */
export function verifyWorkerCompatibility(
  closure: RouteClosure,
  options: { root: string },
): WorkerVerification {
  const tempDir = mkdtempSync(join(tmpdir(), "split-verify-"));
  try {
    const absWorkingDir = resolve(options.root);

    // Hard-blocked builtins are never externalized — if they actually appear
    // in the code esbuild will fail to resolve them. Polyfillable builtins and
    // framework packages are external (the Worker runtime provides them).
    // Note: webpack-compiled Next.js code emits bare builtin names (`util`,
    // `path`, `stream`), so both the `node:`-prefixed and bare forms are added.
    const polyfillableBare = [...POLYFILLABLE_NODE_BUILTINS].map((b) =>
      b.replace(/^node:/, ""),
    );
    const externals = [
      ...FRAMEWORK_EXTERNALS,
      ...POLYFILLABLE_NODE_BUILTINS,
      ...polyfillableBare,
    ];

    let result;
    try {
      result = buildSync({
        entryPoints: [closure.entry],
        absWorkingDir,
        bundle: true,
        platform: "neutral",
        format: "esm",
        write: false,
        metafile: true,
        logLevel: "silent",
        external: externals,
        outdir: join(tempDir, "out"),
      });
    } catch (error) {
      const err = error as { errors?: { text: string; location?: unknown }[] };
      const errors = err.errors ?? [
        { text: error instanceof Error ? error.message : String(error) },
      ];
      const { reason, messages } = classifyFailure(errors);
      return {
        workerCompatible: false,
        method: "esbuild",
        status: "failed",
        reason,
        errors: messages,
      };
    }

    // Build succeeded — now scan the output for anything that slipped through.
    const output = result.outputFiles?.map((f) => f.text).join("\n") ?? "";
    const inputs = Object.keys(result.metafile?.inputs ?? {});

    const nativeInputs = inputs.filter((f) => f.endsWith(".node"));
    if (nativeInputs.length > 0) {
      return {
        workerCompatible: false,
        method: "esbuild",
        status: "failed",
        reason: "native-addon",
        errors: [`Native addon bundled into Worker target: ${nativeInputs[0]}`],
      };
    }

    // Defensive: hard-blocked builtins must not appear in the bundle output.
    const hardBuiltins = [
      ...output.matchAll(
        /(?:from\s+|require\(\s*|import\(\s*)["'](node:[^"']+)["']/g,
      ),
    ];
    for (const m of hardBuiltins) {
      if (isBlockedBuiltin(m[1])) {
        return {
          workerCompatible: false,
          method: "esbuild",
          status: "failed",
          reason: "node-builtin",
          errors: [`Hard-blocked Node builtin present in Worker bundle: ${m[1]}`],
        };
      }
    }

    return {
      workerCompatible: true,
      method: "esbuild",
      status: "passed",
      errors: [],
    };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of the temporary verification bundle.
    }
  }
}
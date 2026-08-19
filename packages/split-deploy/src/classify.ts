import { blockedReasonFromClosure, hasBlockedDependency } from "./blocked-modules.js";
import type {
  ArtifactTarget,
  BlockReason,
  DependencyScan,
  RouteClosure,
  RouteDefinition,
  WorkerVerification,
} from "./types.js";

/**
 * Legacy synchronous classifier. Kept for backwards compatibility — it
 * classifies based on the shallow DependencyScan shape. The production
 * pipeline uses `classifyRouteWithEvidence` instead, which combines the
 * complete closure + esbuild verification.
 *
 * Safety-first: when in doubt, classify as Lambda.
 */
export function classifyRoute(
  route: RouteDefinition,
  dependencyScan?: DependencyScan,
): ArtifactTarget {
  if (route.kind === "static" || route.kind === "prerendered") return "cdn";
  if (route.kind === "middleware" || route.runtime === "edge") return "worker";
  if (route.runtime === "node") return "lambda";

  if (dependencyScan) {
    if (
      hasBlockedDependency(
        dependencyScan.nodeBuiltins,
        dependencyScan.externalImports,
      )
    ) {
      return "lambda";
    }
    if (route.kind === "api" || route.kind === "server") {
      return "worker";
    }
  }

  return "lambda";
}

export interface ClassificationEvidence {
  closure?: RouteClosure;
  verification?: WorkerVerification;
}

export interface ClassificationResult {
  target: ArtifactTarget;
  reason: BlockReason;
  diagnostics: string[];
}

/**
 * Classifies a route given its complete dependency closure and the result of
 * esbuild Worker verification.
 *
 * Priority:
 *   1. Static/prerendered → CDN
 *   2. Middleware / explicit edge → Worker (unless verification failed)
 *   3. Explicit node runtime → Lambda
 *   4. Hard-blocked builtin in closure → Lambda
 *   5. Native *.node binary in closure → Lambda
 *   6. Hard-blocked package in closure → Lambda
 *   7. esbuild verification failed → Lambda (with its reason)
 *   8. Verification passed (or clean closure) → Worker
 *   9. Unknown → Lambda (safe default)
 */
export function classifyRouteWithEvidence(
  route: RouteDefinition,
  evidence: ClassificationEvidence,
): ClassificationResult {
  const diagnostics: string[] = [];
  const { closure, verification } = evidence;

  if (route.kind === "static" || route.kind === "prerendered") {
    return {
      target: "cdn",
      reason: route.kind === "prerendered" ? "prerendered" : "static",
      diagnostics: [],
    };
  }

  const declaredEdge = route.kind === "middleware" || route.runtime === "edge";

  if (route.runtime === "node") {
    diagnostics.push(`Route declares Node.js runtime — not Worker-compatible.`);
    return { target: "lambda", reason: "explicit-node-runtime", diagnostics };
  }

  if (closure) {
    if (closure.blockedBuiltins.length > 0) {
      diagnostics.push(
        `Worker-incompatible Node builtin(s) in closure: ${closure.blockedBuiltins.join(", ")}`,
      );
      return {
        target: "lambda",
        reason: "node-builtin",
        diagnostics: [...diagnostics, thisChain(closure)],
      };
    }
    if (closure.nativeFiles.length > 0) {
      diagnostics.push(
        `Native addon(s) in closure: ${closure.nativeFiles.map((n) => n.path).join(", ")}`,
      );
      return {
        target: "lambda",
        reason: "native-addon",
        diagnostics: [...diagnostics, thisChain(closure)],
      };
    }
    if (closure.blockedPackages.length > 0) {
      diagnostics.push(
        `Hard-blocked package(s) in closure: ${closure.blockedPackages.join(", ")}`,
      );
      return {
        target: "lambda",
        reason: "blocked-package",
        diagnostics: [...diagnostics, thisChain(closure)],
      };
    }
  }

  if (verification && verification.status === "failed") {
    diagnostics.push(
      `esbuild Worker verification failed: ${verification.reason ?? "unknown"}`,
    );
    for (const error of verification.errors.slice(0, 5)) diagnostics.push(`  - ${error}`);
    return {
      target: "lambda",
      reason: verification.reason ?? "esbuild-failure",
      diagnostics,
    };
  }

  if (declaredEdge) {
    if (verification?.status === "failed") {
      return { target: "lambda", reason: "esbuild-failure", diagnostics };
    }
    return { target: "worker", reason: "edge-runtime", diagnostics: [] };
  }

  // Verification passed or the closure is clean — Worker.
  if (verification?.workerCompatible === true || closure?.blockedBuiltins.length === 0) {
    return { target: "worker", reason: "none", diagnostics: [] };
  }

  // Safety default.
  diagnostics.push("Unknown runtime compatibility — promoting to Lambda.");
  return {
    target: "lambda",
    reason: "unknown-runtime",
    diagnostics: [...diagnostics, thisChain(closure)],
  };
}

function thisChain(closure?: RouteClosure): string {
  if (!closure || closure.chain.length === 0) return "";
  return `  dependency chain: ${closure.chain.join(" → ")}`;
}

/** Returns the blocking reason for a closure, if any. */
export function closureBlockReason(
  closure: RouteClosure,
): ReturnType<typeof blockedReasonFromClosure> {
  return blockedReasonFromClosure({
    blockedBuiltins: closure.blockedBuiltins,
    blockedPackages: closure.blockedPackages,
    nativeFiles: closure.nativeFiles,
  });
}
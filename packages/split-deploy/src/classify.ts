import { hasBlockedDependency } from "./blocked-modules.js";
import type {
  ArtifactTarget,
  DependencyScan,
  RouteDefinition,
} from "./types.js";

/**
 * Classifies a route into a runtime target based on its properties and
 * dependency scan results. Follows the safety-first principle: when in
 * doubt, classify as Lambda.
 *
 * Priority:
 *   1. Static/prerendered with no server execution → CDN
 *   2. Middleware or explicit edge runtime → Worker
 *   3. Explicit node runtime → Lambda
 *   4. Has blocked dependency → Lambda
 *   5. API route with no blocked dependencies → Worker
 *   6. Unknown → Lambda (safe default)
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

    // No blocked dependencies detected — safe for worker
    if (route.kind === "api" || route.kind === "server") {
      return "worker";
    }
  }

  // Safety default: unknown compatibility → Lambda
  return "lambda";
}

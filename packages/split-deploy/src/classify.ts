import type {
  ArtifactTarget,
  DependencyScan,
  RouteDefinition,
} from "./types.js";

export function classifyRoute(
  route: RouteDefinition,
  dependencyScan?: DependencyScan,
): ArtifactTarget {
  if (route.kind === "static") return "cdn";
  if (route.kind === "middleware" || route.runtime === "edge") return "worker";
  if (route.runtime === "node") return "lambda";
  if (dependencyScan?.nodeBuiltins.length) return "lambda";
  return "lambda";
}
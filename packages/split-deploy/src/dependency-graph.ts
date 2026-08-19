/**
 * Real dependency graph built from the per-file scanner.
 *
 * Nodes represent files; edges represent resolved imports. The graph
 * preserves the full dependency topology so route closures, shared
 * dependencies and runtime requirements can be derived accurately.
 */
import { DependencyScanner } from "./imports.js";
import type {
  DependencyNode,
  DependencyScan,
  RouteClosure,
} from "./types.js";

export interface GraphEdge {
  from: string;
  to: string;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: GraphEdge[];
  entrypoints: string[];
  root: string;
}

/**
 * Builds a dependency graph from a build root and a set of entrypoints.
 * All files reachable from any entrypoint are included as nodes.
 */
export function buildDependencyGraph(
  root: string,
  entries: string[],
): DependencyGraph {
  const scanner = new DependencyScanner(root);
  const nodes = new Map<string, DependencyNode>();
  const edges: GraphEdge[] = [];
  const visited = new Set<string>();

  for (const entry of entries) {
    if (visited.has(entry)) continue;
    const closure = scanner.closure(entry, { includeFramework: true });
    for (const file of closure.files) {
      if (!nodes.has(file)) nodes.set(file, scanner.scanFile(file));
      for (const resolved of scanner.scanFile(file).resolvedImports) {
        edges.push({ from: file, to: resolved });
      }
    }
  }

  return { nodes, edges, entrypoints: [...entries], root };
}

/** Returns all files transitively reachable from a given entry. */
export function filesForEntry(
  scans: DependencyScan[],
  entry: string,
): string[] {
  const scan = scans.find((s) => s.entry === entry);
  return scan ? scan.files : [];
}

/** Finds files shared between multiple entrypoints (closures). */
export function findSharedChunks(scans: DependencyScan[]): string[] {
  const fileCounts = new Map<string, number>();
  for (const scan of scans) {
    for (const file of scan.files) {
      fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
    }
  }
  return [...fileCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([file]) => file)
    .sort();
}

/**
 * Computes the complete dependency closure for a single entrypoint.
 * The result includes every file, package, builtin and native binary the
 * route needs at runtime.
 */
export function closureForEntry(
  root: string,
  entry: string,
  opts: { includeFramework?: boolean } = {},
): RouteClosure {
  return new DependencyScanner(root).closure(entry, opts);
}
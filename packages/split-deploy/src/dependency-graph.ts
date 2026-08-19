import type { DependencyScan } from "./types.js";

export interface DependencyNode {
  file: string;
  imports: string[];
  nodeBuiltins: string[];
  externalImports: string[];
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  entrypoints: string[];
}

/**
 * Builds a dependency graph from multiple dependency scans.
 * Used to detect shared chunks and ensure artifact isolation.
 */
export function buildDependencyGraph(
  scans: DependencyScan[],
): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const entrypoints: string[] = [];

  for (const scan of scans) {
    entrypoints.push(scan.entry);
    for (const file of scan.files) {
      if (!nodes.has(file)) {
        nodes.set(file, {
          file,
          imports: [],
          nodeBuiltins: [...scan.nodeBuiltins],
          externalImports: [...scan.externalImports],
        });
      }
    }
  }

  return { nodes, entrypoints };
}

/**
 * Returns all files transitively reachable from a given entry in the scans.
 */
export function filesForEntry(
  scans: DependencyScan[],
  entry: string,
): string[] {
  const scan = scans.find((s) => s.entry === entry);
  return scan ? scan.files : [];
}

/**
 * Finds chunks shared between multiple scans (entrypoints).
 */
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

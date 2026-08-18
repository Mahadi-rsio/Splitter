import type { Dirent } from "node:fs";

export type RuntimeHint = "edge" | "node" | "unknown";
export type RouteKind = "static" | "dynamic" | "api" | "middleware" | "unknown";
export type ArtifactTarget = "cdn" | "worker" | "lambda";

export interface RouteDefinition {
  path: string;
  kind: RouteKind;
  runtime: RuntimeHint;
  entry?: string;
  source?: string;
}

export interface OpenNextManifest {
  file: string;
  data: Record<string, unknown>;
}

export interface OpenNextBuild {
  root: string;
  files: string[];
  manifests: OpenNextManifest[];
  assetFiles: string[];
  workerEntries: string[];
  lambdaEntries: string[];
}

export interface DependencyScan {
  entry: string;
  files: string[];
  externalImports: string[];
  nodeBuiltins: string[];
}

export interface ClassifiedRoute extends RouteDefinition {
  target: ArtifactTarget;
  dependencyScan?: DependencyScan;
}

export interface BuildAnalysis {
  inputDir: string;
  routes: ClassifiedRoute[];
  assets: string[];
  entries: Record<ArtifactTarget, string[]>;
  files: Record<ArtifactTarget, string[]>;
  dependencyScans: DependencyScan[];
  warnings: string[];
}

export interface CopyResult {
  outputDir: string;
  copied: Record<ArtifactTarget, string[]>;
  manifestPath: string;
}

export type BuildDirent = Dirent;
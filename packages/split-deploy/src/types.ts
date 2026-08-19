export type RuntimeHint = "edge" | "node" | "unknown";
export type RouteKind = "static" | "prerendered" | "server" | "api" | "middleware" | "unknown";
export type ArtifactTarget = "cdn" | "worker" | "lambda";

export interface RouteDefinition {
  path: string;
  kind: RouteKind;
  runtime: RuntimeHint;
  entry?: string;
  source?: string;
  chunks: string[];
}

export interface OpenNextManifest {
  file: string;
  data: Record<string, unknown>;
}

export interface ServerFunction {
  name: string;
  directory: string;
  entrypoint: string;
  files: string[];
}

export interface OpenNextBuild {
  root: string;
  files: string[];
  manifests: OpenNextManifest[];
  assetFiles: string[];
  serverFunctions: ServerFunction[];
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

export interface SplitManifest {
  version: 1;
  buildId: string;
  tenantId: string;
  routes: Record<string, {
    target: ArtifactTarget;
    entrypoint?: string;
    dependencies?: string[];
  }>;
  cdn: { files: string[] };
  worker: { entrypoints: string[]; files: string[] };
  lambda: { functions: Record<string, { entrypoint: string; files: string[] }> };
}

export interface CopyResult {
  outputDir: string;
  copied: Record<ArtifactTarget, string[]>;
  manifestPath: string;
}

export interface SplitOptions {
  input: string;
  output: string;
  tenantId: string;
  buildId: string;
}

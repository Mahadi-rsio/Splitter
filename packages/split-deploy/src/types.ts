export type RuntimeHint = "edge" | "node" | "unknown";
export type RouteKind = "static" | "prerendered" | "server" | "api" | "middleware" | "unknown";
export type ArtifactTarget = "cdn" | "worker" | "lambda";

/**
 * Why a route was classified into a particular target. Kept as a stable
 * string union so consumers can render diagnostics and the manifest can
 * explain every decision.
 */
export type BlockReason =
  | "none"
  | "static"
  | "prerendered"
  | "edge-runtime"
  | "node-builtin"
  | "native-addon"
  | "blocked-package"
  | "esbuild-failure"
  | "unresolved-dependency"
  | "unknown-runtime"
  | "explicit-node-runtime";

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

/** A native binary (*.node) discovered in the build output. */
export interface NativeFileInfo {
  /** Path relative to the build root, e.g. node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node */
  path: string;
  /** Owning npm package, e.g. @img/sharp-linux-x64 */
  package: string;
  reason: "native-addon";
}

/**
 * Per-file dependency information. One node exists for every JavaScript
 * file that participates in the dependency graph.
 */
export interface DependencyNode {
  file: string;
  /** Owning npm package if the file lives under node_modules/<pkg>. */
  package?: string;
  /** Raw import requests exactly as written in the source. */
  imports: string[];
  /** Import requests that resolved to concrete files. */
  resolvedImports: string[];
  /** Bare (non-relative) requests that could not be resolved to a file. */
  externalImports: string[];
  /** Node builtins normalized to `node:` form. */
  nodeBuiltins: string[];
  /** *.node binaries reached from this file. */
  nativeFiles: string[];
}

/**
 * The complete transitive dependency closure of a single entrypoint.
 * Every file a route needs in order to run is listed in `files`.
 */
export interface RouteClosure {
  entry: string;
  /** Complete set of files reachable from the entry (relative paths). */
  files: string[];
  /** Distinct non-framework packages pulled into the closure. */
  packages: string[];
  /** Framework packages treated as runtime-provided (external to the artifact). */
  frameworkPackages: string[];
  /** All Node builtins detected in the closure (normalized `node:` form). */
  nodeBuiltins: string[];
  /** Hard-blocked Node builtins — these make the route Lambda-only. */
  blockedBuiltins: string[];
  /** Hard-blocked packages present in the closure. */
  blockedPackages: string[];
  /** Native binaries found inside included packages. */
  nativeFiles: NativeFileInfo[];
  /** Bare imports that could not be resolved (non-builtin, non-framework). */
  unresolved: string[];
  /** Human-readable chain from the entry to the first blocking cause. */
  chain: string[];
}

/** Result of the esbuild Worker-verification pass. */
export interface WorkerVerification {
  workerCompatible: boolean;
  method: "esbuild";
  status: "passed" | "failed" | "skipped";
  reason?: BlockReason;
  errors: string[];
}

/** Backwards-compatible shallow scan shape (legacy consumers). */
export interface DependencyScan {
  entry: string;
  files: string[];
  externalImports: string[];
  nodeBuiltins: string[];
}

export interface ClassifiedRoute extends RouteDefinition {
  target: ArtifactTarget;
  reason: BlockReason;
  closure?: RouteClosure;
  verification?: WorkerVerification;
  diagnostics: string[];
}

export interface BuildAnalysis {
  inputDir: string;
  routes: ClassifiedRoute[];
  assets: string[];
  entries: Record<ArtifactTarget, string[]>;
  files: Record<ArtifactTarget, string[]>;
  dependencyScans: DependencyScan[];
  closures: RouteClosure[];
  nativeFiles: NativeFileInfo[];
  warnings: string[];
}

export interface RouteManifestDependencies {
  files: string[];
  packages: string[];
  nodeBuiltins: string[];
  nativeModules: string[];
}

export interface RouteManifestVerification {
  workerCompatible: boolean;
  method: string;
  status: string;
  reason?: string;
}

export interface RouteManifestEntry {
  target: ArtifactTarget;
  entrypoint?: string;
  /** Legacy field: external package names / dependency files. */
  dependencies?: string[];
  /** Why this route landed in its target. */
  reason: string;
  dependencyClosure: RouteManifestDependencies;
  verification: RouteManifestVerification;
}

/**
 * Split manifest. `version` is kept at 1 for backwards compatibility with
 * existing consumers; new fields are additive.
 */
export interface SplitManifest {
  version: 1;
  buildId: string;
  tenantId: string;
  routes: Record<string, RouteManifestEntry>;
  cdn: { files: string[] };
  worker: {
    entrypoints: string[];
    files: string[];
    /** Framework packages expected to be provided by the Worker runtime. */
    externalRuntime: string[];
  };
  lambda: {
    functions: Record<string, {
      entrypoint: string;
      files: string[];
      nodeBuiltins: string[];
      nativeModules: string[];
    }>;
  };
  diagnostics: string[];
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

/** Package classification categories used by blocked-modules.ts. */
export type PackageCategory = "hard-blocked" | "risky" | "safe" | "framework" | "native";
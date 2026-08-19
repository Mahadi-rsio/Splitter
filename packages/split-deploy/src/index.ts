export { analyzeOpenNext, summarizeAnalysis } from "./analyze.js";
export {
  BLOCKED_MODULES,
  FRAMEWORK_EXTERNALS,
  HARD_BLOCKED_NODE_BUILTINS,
  HARD_BLOCKED_PACKAGES,
  NATIVE_PACKAGES,
  NODE_BUILTINS,
  POLYFILLABLE_NODE_BUILTINS,
  RISKY_PACKAGES,
  SAFE_PACKAGES,
  blockedReasonFromClosure,
  categoryOf,
  hasBlockedDependency,
  isBlockedBuiltin,
  isBlockedModule,
  isBlockedPackage,
  isFrameworkPackage,
  isRiskyPackage,
  isSafePackage,
  packageNameOf,
} from "./blocked-modules.js";
export {
  classifyRoute,
  classifyRouteWithEvidence,
  closureBlockReason,
} from "./classify.js";
export { copySplitArtifacts } from "./copy.js";
export {
  buildDependencyGraph,
  closureForEntry,
  filesForEntry,
  findSharedChunks,
} from "./dependency-graph.js";
export { DependencyScanner, computeClosure, importsFrom, normalizeBuiltin, scanJavaScriptDependencies } from "./imports.js";
export {
  findNativeFilesInPackage,
  owningPackageOf,
  packageDirOf,
  packagesWithNativeFiles,
  readPackageJson,
  scanNativeFiles,
} from "./native-scanner.js";
export { readJsonFile, readOpenNextBuild } from "./reader.js";
export { detectRoutes } from "./routes.js";
export { validateSplitOutput } from "./validator.js";
export { verifyWorkerCompatibility } from "./verify.js";
export type * from "./types.js";
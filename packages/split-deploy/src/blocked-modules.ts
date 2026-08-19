/**
 * Runtime-compatibility classification for Node builtins and npm packages.
 *
 * The meaning of a "blocked" module is: Worker-incompatible → Lambda candidate.
 * It does NOT mean the package should be deleted — the full dependency closure
 * must follow the route into Lambda.
 *
 * Categories:
 *  - HARD BLOCKED   definitely unsafe for Workers (native/server-only APIs)
 *  - RISKY          require actual dependency/bundle analysis; never auto-blocked
 *  - SAFE           pure JavaScript — never block
 *  - FRAMEWORK      platform-provided runtime (next, react, ...) — externalized
 *  - NATIVE         known native/Node-only packages (subset of hard blocked)
 */
import type { BlockReason, PackageCategory } from "./types.js";

/**
 * Node builtins that are definitely unsafe in a Worker runtime.
 * Anything here (or its bare, non-`node:` variant) forces Lambda.
 */
export const HARD_BLOCKED_NODE_BUILTINS = new Set([
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "node:net",
  "node:tls",
  "node:dgram",
  "node:cluster",
  "node:worker_threads",
  "node:vm",
  "node:module",
  "node:inspector",
  "node:repl",
  "node:tty",
  "node:http2",
  "node:perf_hooks",
  "node:async_hooks",
]);

/**
 * Node builtins that are NOT hard-blocked. Many of these have Worker-side
 * polyfills (buffer, stream, process, ...). They are still reported in the
 * manifest so a deployer can decide, but by themselves they do not force
 * Lambda classification. Note: `node:path` is intentionally absent from the
 * hard-blocked set — it is polyfillable and would otherwise create a huge
 * number of false positives for every Next.js server route.
 */
export const POLYFILLABLE_NODE_BUILTINS = new Set([
  "node:assert",
  "node:buffer",
  "node:console",
  "node:constants",
  "node:crypto",
  "node:diagnostics_channel",
  "node:dns",
  "node:events",
  "node:http",
  "node:https",
  "node:os",
  "node:path",
  "node:process",
  "node:punycode",
  "node:querystring",
  "node:readline",
  "node:stream",
  "node:string_decoder",
  "node:timers",
  "node:trace_events",
  "node:url",
  "node:util",
  "node:v8",
  "node:wasi",
  "node:zlib",
]);

/** Every known Node builtin, used for detection and reporting. */
export const NODE_BUILTINS = new Set([
  ...HARD_BLOCKED_NODE_BUILTINS,
  ...POLYFILLABLE_NODE_BUILTINS,
]);

/**
 * npm packages that require native binaries or Node-only server APIs.
 * A route whose closure contains any of these must run on Lambda.
 */
export const HARD_BLOCKED_PACKAGES = new Set([
  // Native image / processing
  "sharp",
  "canvas",
  "opencv4nodejs",
  "onnxruntime-node",
  "@tensorflow/tfjs-node",
  // Databases with native engines
  "better-sqlite3",
  "sqlite3",
  "oracledb",
  "ibm_db",
  "duckdb",
  "node-gyp",
  // Prisma (native query engine)
  "@prisma/client",
  // PostgreSQL client with native bindings / server sockets
  "pg",
  "pg-native",
  // Auth/hashing with native bindings
  "argon2",
  "bcrypt",
  "node-crypton",
  // FFI / native bindings
  "ffi-napi",
  "ref-napi",
  "ref-array-napi",
  "ref-struct-napi",
  "koffi",
  // Hardware / serial
  "serialport",
  "node-hid",
  // Browser automation (bundles Chromium)
  "puppeteer",
  "puppeteer-core",
  "playwright",
  "playwright-core",
  "selenium-webdriver",
]);

/**
 * Packages that are frequently (and wrongly) assumed to be Worker-incompatible.
 * They are NOT auto-blocked. They require actual dependency/bundle analysis —
 * if the resolved closure is pure JS and esbuild verification passes, they may
 * legitimately stay on the Worker.
 */
export const RISKY_PACKAGES = new Set([
  "axios",
  "jose",
  "bcryptjs",
  "graphql",
  "graphql-request",
  "firebase",
  "firebase-admin",
  "drizzle-orm",
  "typeorm",
  "knex",
  "mongoose",
  "sequelize",
  "ioredis",
  "redis",
  "mqtt",
  "amqplib",
  "kafkajs",
]);

/**
 * Pure-JS packages that are Worker-safe and must never be blocked.
 * Kept for documentation and fast-path decisions.
 */
export const SAFE_PACKAGES = new Set([
  "zod",
  "valibot",
  "lodash",
  "lodash-es",
  "remeda",
  "date-fns",
  "dayjs",
  "nanoid",
  "uuid",
  "dequal",
  "fast-deep-equal",
  "marked",
  "markdown-it",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
]);

/**
 * Framework packages that the Worker runtime is expected to provide.
 * These are externalized for Worker verification and are NOT physically
 * copied into the Worker artifact; they are recorded in the manifest as
 * `externalRuntime`. For Lambda they are copied normally.
 */
export const FRAMEWORK_EXTERNALS = new Set([
  "next",
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "styled-jsx",
  "@swc/helpers",
  "@swc/helpers/_/_interop_require_default",
  "@swc/helpers/_/_interop_require_wildcard",
  "client-only",
  "server-only",
]);

const BLOCKED_PACKAGE_ALIASES = new Map<string, string>([
  ["@aws-sdk", "@aws-sdk/*"],
  ["@supabase/supabase-js", "@supabase/supabase-js"],
]);

/** Packages that carry native binaries (a superset of hard-blocked native ones). */
export const NATIVE_PACKAGES = new Set([
  "sharp",
  "@prisma/client",
  "pg",
  "better-sqlite3",
  "sqlite3",
  "canvas",
  "bcrypt",
  "argon2",
  "ffi-napi",
  "ref-napi",
  "serialport",
  "node-hid",
  "oracledb",
  "ibm_db",
  "duckdb",
  "onnxruntime-node",
  "@tensorflow/tfjs-node",
  "opencv4nodejs",
  "puppeteer",
  "playwright",
]);

/**
 * Legacy flat list of blocked module names (builtins + packages).
 * New code should prefer the typed sets above.
 */
export const BLOCKED_MODULES = new Set<string>([
  ...HARD_BLOCKED_NODE_BUILTINS,
  ...HARD_BLOCKED_PACKAGES,
  ...NATIVE_PACKAGES,
]);

const RISKY_SCOPES = new Set([
  "@aws-sdk",
  "@supabase",
  "@azure",
  "@google-cloud",
  "@aws-amplify",
]);

/**
 * Returns the "package name" of an import specifier:
 *   - `next/dist/...`         → `next`
 *   - `@scope/pkg/sub/path`   → `@scope/pkg`
 *   - `zod`                   → `zod`
 */
export function packageNameOf(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0];
}

export function categoryOf(specifier: string): PackageCategory {
  const name = packageNameOf(specifier);
  if (name.startsWith("@") && name.split("/").length >= 2) {
    const scope = name.split("/")[0];
    if (RISKY_SCOPES.has(scope)) return "risky";
  }
  if (FRAMEWORK_EXTERNALS.has(name)) return "framework";
  if (HARD_BLOCKED_PACKAGES.has(name) || NATIVE_PACKAGES.has(name)) {
    return "hard-blocked";
  }
  if (RISKY_PACKAGES.has(name) || BLOCKED_PACKAGE_ALIASES.has(name)) {
    return "risky";
  }
  if (SAFE_PACKAGES.has(name)) return "safe";
  return "risky";
}

export function isBlockedModule(moduleName: string): boolean {
  if (moduleName.startsWith("node:")) {
    return HARD_BLOCKED_NODE_BUILTINS.has(moduleName);
  }
  const category = categoryOf(moduleName);
  return category === "hard-blocked" || category === "native";
}

export function isBlockedBuiltin(builtin: string): boolean {
  const normalized = builtin.startsWith("node:") ? builtin : `node:${builtin}`;
  return HARD_BLOCKED_NODE_BUILTINS.has(normalized);
}

export function isBlockedPackage(pkg: string): boolean {
  return categoryOf(pkg) === "hard-blocked";
}

export function isFrameworkPackage(pkg: string): boolean {
  return FRAMEWORK_EXTERNALS.has(pkg);
}

export function isRiskyPackage(pkg: string): boolean {
  return categoryOf(pkg) === "risky";
}

export function isSafePackage(pkg: string): boolean {
  return categoryOf(pkg) === "safe";
}

/**
 * Legacy helper kept for compatibility: returns true when the given
 * builtins/external imports contain a hard-blocked dependency.
 */
export function hasBlockedDependency(
  nodeBuiltins: string[],
  externalImports: string[],
): boolean {
  for (const builtin of nodeBuiltins) {
    if (isBlockedBuiltin(builtin)) return true;
  }
  for (const pkg of externalImports) {
    const name = pkg.startsWith("@")
      ? pkg.split("/").slice(0, 2).join("/")
      : pkg.split("/")[0];
    if (isBlockedModule(name)) return true;
  }
  return false;
}

/**
 * Determines the blocking reason from a route closure's static analysis.
 * Returns undefined when static analysis finds no blocking cause.
 */
export function blockedReasonFromClosure(input: {
  blockedBuiltins: string[];
  blockedPackages: string[];
  nativeFiles: { path: string; package: string }[];
}): BlockReason | undefined {
  if (input.blockedBuiltins.length > 0) return "node-builtin";
  if (input.nativeFiles.length > 0) return "native-addon";
  if (input.blockedPackages.length > 0) return "blocked-package";
  return undefined;
}
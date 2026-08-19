/**
 * Modules known to be incompatible with edge/Worker runtimes.
 * A route importing any of these (directly or transitively) must run on Lambda.
 */
export const BLOCKED_MODULES = new Set([
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:child_process",
  "node:net",
  "node:tls",
  "node:dgram",
  "node:worker_threads",
  "node:cluster",
  "node:dns",
  "node:http2",
  "node:inspector",
  "node:readline",
  "node:repl",
  "node:vm",
  "node:v8",
  "node:trace_events",
  "node:diagnostics_channel",
  "fs",
  "fs/promises",
  "child_process",
  "net",
  "tls",
  "dgram",
  "worker_threads",
  "cluster",
  "dns",
  "http2",
  "inspector",
  "readline",
  "repl",
  "vm",
  "v8",
  "sharp",
  "@prisma/client",
  "pg",
  "better-sqlite3",
  "sqlite3",
  "canvas",
  "node-gyp",
]);

/**
 * npm packages known to require native binaries or Node-only APIs.
 */
export const NATIVE_PACKAGES = new Set([
  "sharp",
  "@prisma/client",
  "pg",
  "better-sqlite3",
  "sqlite3",
  "canvas",
  "bcrypt",
  "argon2",
]);

export function isBlockedModule(moduleName: string): boolean {
  return BLOCKED_MODULES.has(moduleName);
}

export function hasBlockedDependency(
  nodeBuiltins: string[],
  externalImports: string[],
): boolean {
  for (const builtin of nodeBuiltins) {
    if (BLOCKED_MODULES.has(builtin)) return true;
  }
  for (const pkg of externalImports) {
    const name = pkg.startsWith("@")
      ? pkg.split("/").slice(0, 2).join("/")
      : pkg.split("/")[0];
    if (BLOCKED_MODULES.has(name) || NATIVE_PACKAGES.has(name)) return true;
  }
  return false;
}

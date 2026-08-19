/**
 * Modules/packages that should be treated as Node.js-only or
 * high-risk for a Workers/edge runtime.
 *
 * IMPORTANT:
 * This is a safety-oriented denylist, not a complete compatibility proof.
 * A package not present here may still fail in Workers.
 */

/* -------------------------------------------------------------------------- */
/* Node.js built-in modules                                                   */
/* -------------------------------------------------------------------------- */

export const BLOCKED_NODE_BUILTINS = new Set([
  // Core filesystem
  "fs",
  "fs/promises",
  "node:fs",
  "node:fs/promises",

  // Process / OS
  "process",
  "node:process",
  "os",
  "node:os",
  "child_process",
  "node:child_process",

  // Networking
  "net",
  "node:net",
  "tls",
  "node:tls",
  "dgram",
  "node:dgram",
  "dns",
  "node:dns",
  "dns/promises",
  "node:dns/promises",
  "http",
  "node:http",
  "https",
  "node:https",
  "http2",
  "node:http2",

  // Cluster / workers
  "cluster",
  "node:cluster",
  "worker_threads",
  "node:worker_threads",

  // Native / low-level
  "inspector",
  "node:inspector",
  "repl",
  "node:repl",
  "readline",
  "node:readline",
  "readline/promises",
  "node:readline/promises",

  // TTY / terminal
  "tty",
  "node:tty",

  // VM / V8 internals
  "vm",
  "node:vm",
  "v8",
  "node:v8",

  // Module loading / internals
  "module",
  "node:module",
  "constants",
  "node:constants",

  // Native bindings / FFI
  "ffi",
  "node:ffi",
  "ffi-napi",
  "node-gyp",

  // Unix / system interfaces
  "sys",
  "node:sys",
  "syslog",
  "node:syslog",

  // Performance / tracing
  "perf_hooks",
  "node:perf_hooks",
  "async_hooks",
  "node:async_hooks",
  "trace_events",
  "node:trace_events",

  // HTTP diagnostics
  "diagnostics_channel",
  "node:diagnostics_channel",

  // WASI / native execution
  "wasi",
  "node:wasi",

  // SQLite / database related built-ins where applicable
  "sqlite",
  "node:sqlite",
]);

/* -------------------------------------------------------------------------- */
/* Native Node.js addons / packages                                           */
/* -------------------------------------------------------------------------- */

/**
 * Packages known to commonly contain native binaries, native bindings,
 * platform-specific binaries, or require Node.js native APIs.
 */
export const BLOCKED_NATIVE_PACKAGES = new Set([
  // Image processing
  "sharp",
  "@img/sharp",
  "canvas",
  "canvas-prebuilt",
  "jimp",
  "gm",
  "imagemagick",
  "imagemagick-native",
  "node-imagemagick",
  "pngjs-image",

  // Crypto / password hashing native implementations
  "bcrypt",
  "bcryptjs", // safe-ish in many runtimes, but keep conservative if bundled
  "bcrypt-nodejs",
  "argon2",
  "argon2-browser",
  "scrypt",
  "scrypt-js",
  "node-scrypt",
  "scrypt-kdf",
  "libsodium",
  "libsodium-wrappers",
  "sodium-native",
  "node-sodium",
  "crypto",
  "node-forge",

  // Database native drivers
  "better-sqlite3",
  "sqlite3",
  "sqlite",
  "sqlite3-offline-next",
  "better-sqlite3-multiple-ciphers",
  "sqlcipher",
  "node-sqlite3-wasm",
  "duckdb",
  "duckdb-async",
  "duckdb-node",
  "oracledb",
  "ibm_db",
  "tedious",
  "mssql",

  // PostgreSQL native / system integrations
  "pg-native",
  "libpq",
  "postgres-native",

  // MySQL native integrations
  "mysql2",
  "mysql-native",

  // Redis native/system bindings
  "ioredis",
  "redis-parser",

  // FFI / native bindings
  "ffi-napi",
  "ref-napi",
  "ref",
  "node-ffi",
  "node-ffi-napi",
  "bindings",
  "node-gyp-build",
  "node-pre-gyp",
  "prebuild",
  "prebuild-install",

  // Serial / hardware
  "serialport",
  "@serialport/bindings",
  "@serialport/bindings-cpp",
  "usb",
  "usb-detection",
  "node-hid",
  "hid",
  "i2c-bus",
  "spi-device",
  "onoff",
  "bluetooth-hci-socket",

  // Compression / native acceleration
  "iltorb",
  "node-zopfli",
  "lzma-native",
  "snappy",
  "node-snappy",
  "sodium-native",

  // Native XML / parsing
  "libxmljs",
  "libxmljs2",
  "node-expat",
  "node-libxml",

  // Native image/video/media
  "ffmpeg-static",
  "fluent-ffmpeg",
  "node-ffmpeg",
  "av",
  "node-av",
  "opencv4nodejs",
  "opencv4nodejs-prebuilt",
  "node-opencv",

  // PDF/native rendering
  "pdfium",
  "pdfkit-native",
  "puppeteer",
  "puppeteer-core",
  "playwright",
  "playwright-core",

  // Native ML
  "onnxruntime-node",
  "@tensorflow/tfjs-node",
  "@tensorflow/tfjs-node-gpu",
  "node-nlp",
  "sharp-cli",

  // Hardware / system
  "systeminformation",
  "node-hid",
  "usb",

  // Native protobuf / performance modules
  "bufferutil",
  "utf-8-validate",
]);

/* -------------------------------------------------------------------------- */
/* Node-oriented frameworks / server libraries                                */
/* -------------------------------------------------------------------------- */

/**
 * These packages are not necessarily native, but are strongly associated
 * with Node.js server environments and should be treated conservatively.
 */
export const BLOCKED_NODE_PACKAGES = new Set([
  // Express ecosystem
  "express",
  "express-session",
  "connect",
  "compression",
  "serve-static",
  "cookie-parser",
  "body-parser",
  "multer",

  // Node HTTP servers
  "fastify",
  "@fastify/node",
  "@fastify/express",
  "koa",
  "@koa/router",
  "hapi",
  "@hapi/hapi",
  "@hapi/catbox",
  "restify",

  // Node server utilities
  "http-proxy",
  "http-proxy-middleware",
  "http-errors",
  "proxy-agent",
  "https-proxy-agent",
  "http-proxy-agent",
  "socks-proxy-agent",

  // Node filesystem helpers
  "fs-extra",
  "graceful-fs",
  "memfs",
  "proper-lockfile",
  "lockfile",
  "tmp",
  "temp",
  "temp-dir",
  "file-type",

  // Process managers
  "pm2",
  "cluster",
  "forever",
  "nodemon",

  // Shell / command execution
  "execa",
  "shelljs",
  "cross-spawn",
  "spawn-command",
  "child-process-promise",
  "shell-quote",

  // Environment/system
  "env-paths",
  "os-name",
  "systeminformation",
  "process-exists",
  "pidusage",

  // Native build systems
  "node-gyp",
  "node-gyp-build",
  "node-pre-gyp",
  "prebuild",
  "prebuild-install",
]);

/* -------------------------------------------------------------------------- */
/* Database packages                                                           */
/* -------------------------------------------------------------------------- */

export const BLOCKED_DATABASE_PACKAGES = new Set([
  // PostgreSQL
  "pg-native",
  "pg-promise",
  "postgres",
  "postgresql",
  "node-postgres",
  "libpq",

  // MySQL
  "mysql",
  "mysql2",
  "mysql-native",

  // SQLite
  "sqlite",
  "sqlite3",
  "better-sqlite3",
  "sql.js",
  "sqlcipher",

  // MongoDB
  "mongodb",
  "mongoose",
  "mongodb-client-encryption",

  // Redis
  "redis",
  "ioredis",
  "node-redis",

  // MSSQL
  "mssql",
  "tedious",

  // Oracle
  "oracledb",

  // IBM DB
  "ibm_db",

  // DuckDB
  "duckdb",
  "duckdb-async",
  "duckdb-node",

  // Cassandra
  "cassandra-driver",

  // Neo4j
  "neo4j-driver",

  // Elasticsearch Node client
  "@elastic/elasticsearch",
]);

/* -------------------------------------------------------------------------- */
/* Browser automation / desktop / GUI                                         */
/* -------------------------------------------------------------------------- */

export const BLOCKED_BROWSER_AUTOMATION_PACKAGES = new Set([
  "puppeteer",
  "puppeteer-core",
  "playwright",
  "playwright-core",

  // Selenium
  "selenium-webdriver",

  // Browser binary management
  "@puppeteer/browsers",
  "chromedriver",
  "geckodriver",

  // Electron
  "electron",
  "electron-builder",
  "electron-packager",
  "electron-rebuild",

  // Desktop
  "node-window-manager",
  "robotjs",
  "nut.js",
  "@nut-tree/nut-js",
]);

/* -------------------------------------------------------------------------- */
/* File/archive/compression libraries that commonly depend on Node APIs       */
/* -------------------------------------------------------------------------- */

export const BLOCKED_FILE_SYSTEM_PACKAGES = new Set([
  "tar",
  "tar-fs",
  "tar-stream",
  "unzipper",
  "adm-zip",
  "extract-zip",
  "decompress",
  "decompress-tar",
  "decompress-unzip",
  "archiver",
  "zip-stream",
  "yauzl",
  "yazl",
  "7zip-bin",
  "node-7z",
  "file-uri-to-path",
  "glob",
  "fast-glob",
  "globby",
  "micromatch",
  "chokidar",
  "fsevents",
]);

/* -------------------------------------------------------------------------- */
/* Native networking / low-level networking                                   */
/* -------------------------------------------------------------------------- */

export const BLOCKED_NETWORK_PACKAGES = new Set([
  "net",
  "tls",
  "dgram",
  "dns",
  "node-fetch-native",

  // Raw socket / native networking
  "node-net",
  "node-tls",
  "socks",
  "socks-proxy-agent",
  "ssh2",
  "ssh2-sftp-client",
  "node-ssh",
  "ftp",
  "basic-ftp",

  // WebSocket implementations that may depend on Node internals
  "ws",
  "uWebSockets.js",
  "uws",
]);

/* -------------------------------------------------------------------------- */
/* SSH / Git / filesystem-backed developer tooling                            */
/* -------------------------------------------------------------------------- */

export const BLOCKED_DEVTOOLS_PACKAGES = new Set([
  "simple-git",
  "isomorphic-git", // keep conservative; depends on runtime features
  "nodegit",
  "git",
  "git-http-backend",

  "ssh2",
  "node-ssh",
  "ssh2-sftp-client",

  "npm",
  "pnpm",
  "yarn",
  "bun",
  "corepack",

  "typescript",
  "ts-node",
  "tsx",
  "esbuild",
  "webpack",
  "rollup",
  "vite",
]);

/* -------------------------------------------------------------------------- */
/* Cloud SDKs / server-oriented packages that deserve conservative handling   */
/* -------------------------------------------------------------------------- */

/**
 * NOTE:
 * Do NOT automatically mark every cloud SDK as Node-only.
 * Many SDKs have browser/edge-compatible builds.
 *
 * These are included only where Node-specific functionality is commonly
 * pulled into server-side usage.
 */
export const BLOCKED_SERVER_SDK_PACKAGES = new Set([
  // AWS legacy / Node-heavy packages
  "aws-sdk",

  // AWS credential / filesystem helpers
  "@aws-sdk/credential-providers",
  "@aws-sdk/credential-provider-node",

  // Google Cloud Node libraries
  "@google-cloud/storage",
  "@google-cloud/pubsub",
  "@google-cloud/compute",
  "@google-cloud/functions",
  "@google-cloud/logging",
  "@google-cloud/secret-manager",
  "@google-cloud/bigquery",

  // Azure Node-oriented SDKs
  "@azure/identity",
  "@azure/storage-blob",
  "@azure/storage-file-share",
  "@azure/storage-queue",

  // Firebase Admin is Node/server-oriented
  "firebase-admin",

  // Supabase server/admin packages
  "@supabase/node-fetch",
]);

/* -------------------------------------------------------------------------- */
/* ORM packages                                                               */
/* -------------------------------------------------------------------------- */

export const BLOCKED_ORM_PACKAGES = new Set([
  // Prisma
  "prisma",
  "@prisma/client",
  "@prisma/engines",
  "@prisma/engines-version",

  // Sequelize
  "sequelize",

  // TypeORM
  "typeorm",

  // Knex
  "knex",

  // Objection
  "objection",

  // MikroORM
  "@mikro-orm/core",
  "@mikro-orm/knex",
  "@mikro-orm/postgresql",
  "@mikro-orm/mysql",
  "@mikro-orm/sqlite",

  // Bookshelf
  "bookshelf",

  // Waterline
  "waterline",

  // Drizzle drivers that may pull Node database drivers
  "drizzle-orm/node-postgres",
  "drizzle-orm/node-mysql2",
  "drizzle-orm/better-sqlite3",
]);

/* -------------------------------------------------------------------------- */
/* Node-specific package patterns                                             */
/* -------------------------------------------------------------------------- */

/**
 * Packages that are dangerous when imported from a Worker bundle.
 *
 * These are prefixes rather than exact packages.
 */
export const BLOCKED_PACKAGE_PREFIXES = [
  // Node native addon namespaces
  "@mapbox/",
  "@serialport/",
  "@node-rs/",

  // Node native bindings
  "node-",

  // Native image libraries
  "@img/",

  // Prisma engines
  "@prisma/",
] as const;

/* -------------------------------------------------------------------------- */
/* Combined denylist                                                          */
/* -------------------------------------------------------------------------- */

export const BLOCKED_MODULES = new Set([
  ...BLOCKED_NODE_BUILTINS,
  ...BLOCKED_NATIVE_PACKAGES,
  ...BLOCKED_NODE_PACKAGES,
  ...BLOCKED_DATABASE_PACKAGES,
  ...BLOCKED_BROWSER_AUTOMATION_PACKAGES,
  ...BLOCKED_FILE_SYSTEM_PACKAGES,
  ...BLOCKED_NETWORK_PACKAGES,
  ...BLOCKED_DEVTOOLS_PACKAGES,
  ...BLOCKED_SERVER_SDK_PACKAGES,
  ...BLOCKED_ORM_PACKAGES,
]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function isBlockedPackage(name: string): boolean {
  if (BLOCKED_MODULES.has(name)) {
    return true;
  }

  return BLOCKED_PACKAGE_PREFIXES.some(
    (prefix) => name === prefix.slice(0, -1) || name.startsWith(prefix),
  );
}

export function isBlockedBuiltin(name: string): boolean {
  return BLOCKED_NODE_BUILTINS.has(name);
}

/**
 * Returns the reason why a module/package is blocked.
 * Useful for warnings and manifest diagnostics.
 */
export function getBlockedReason(name: string): string | undefined {
  if (BLOCKED_NODE_BUILTINS.has(name)) {
    return "Node.js builtin module is not Worker-compatible";
  }

  if (BLOCKED_NATIVE_PACKAGES.has(name)) {
    return "Package commonly uses native Node.js bindings or native binaries";
  }

  if (BLOCKED_DATABASE_PACKAGES.has(name)) {
    return "Database driver/package is treated as Node.js/server-only";
  }

  if (BLOCKED_BROWSER_AUTOMATION_PACKAGES.has(name)) {
    return "Browser automation/desktop package requires Node.js or native binaries";
  }

  if (BLOCKED_FILE_SYSTEM_PACKAGES.has(name)) {
    return "Package relies on filesystem/archive APIs that are unsafe for Workers";
  }

  if (BLOCKED_NETWORK_PACKAGES.has(name)) {
    return "Package relies on Node.js networking/socket APIs";
  }

  if (BLOCKED_DEVTOOLS_PACKAGES.has(name)) {
    return "Development/build tooling is not suitable for Worker runtime";
  }

  if (BLOCKED_SERVER_SDK_PACKAGES.has(name)) {
    return "Server-oriented SDK may depend on Node.js runtime features";
  }

  if (BLOCKED_ORM_PACKAGES.has(name)) {
    return "ORM/database package is treated conservatively as Node.js-only";
  }

  if (BLOCKED_PACKAGE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return "Package matches a known Node/native package namespace";
  }

  return undefined;
}

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import type { DependencyScan } from "./types.js";

const JAVASCRIPT_EXTENSIONS = [".js", ".mjs", ".cjs"];
const RESOLUTION_EXTENSIONS = [...JAVASCRIPT_EXTENSIONS, ".json", ".wasm"];
const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

function isJavaScript(file: string): boolean {
  return JAVASCRIPT_EXTENSIONS.includes(extname(file));
}

function collectDirectoryFiles(root: string, directory: string): string[] {
  const absolute = join(root, directory);
  const files: string[] = [];
  if (!existsSync(absolute) || !lstatSync(absolute).isDirectory()) return files;

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectDirectoryFiles(root, child));
    else if (entry.isFile()) files.push(toPosix(child));
  }
  return files;
}

function isNodeBuiltin(importPath: string): boolean {
  if (importPath.startsWith("node:")) return true;
  const name = importPath.split("/")[0];
  return NODE_BUILTINS.has(name);
}

function importsFrom(source: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /\bimport\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/g,
    /\bexport\s+[\s\S]*?\sfrom\s+["']([^"']+)["']/g,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) imports.add(match[1]);
    }
  }
  return [...imports];
}

function resolveRelativeImport(
  root: string,
  fromFile: string,
  request: string,
): string | undefined {
  const base = normalize(join(dirname(fromFile), request));
  const candidates = [
    base,
    ...RESOLUTION_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...RESOLUTION_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    const absolute = join(root, candidate);
    if (existsSync(absolute) && lstatSync(absolute).isFile()) {
      return toPosix(candidate);
    }
  }
  return undefined;
}

/**
 * Scans bundled JavaScript without executing it. Builds a transitive
 * dependency graph by following relative imports and recording external
 * package references and Node built-in usage.
 */
export function scanJavaScriptDependencies(
  root: string,
  entry: string,
): DependencyScan {
  const roots =
    existsSync(join(root, entry)) && lstatSync(join(root, entry)).isDirectory()
      ? collectDirectoryFiles(root, entry)
      : [toPosix(entry)];
  const files = new Set<string>();
  const externalImports = new Set<string>();
  const nodeBuiltins = new Set<string>();
  const pending = [...roots.filter((file) => existsSync(join(root, file)))];

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || files.has(file)) continue;
    files.add(file);
    if (!isJavaScript(file)) continue;

    const source = readFileSync(join(root, file), "utf8");
    for (const request of importsFrom(source)) {
      if (isNodeBuiltin(request)) {
        nodeBuiltins.add(
          request.startsWith("node:") ? request : `node:${request}`,
        );
      } else if (request.startsWith(".") || request.startsWith("/")) {
        const resolved = resolveRelativeImport(root, file, request);
        if (resolved && !files.has(resolved)) pending.push(resolved);
        else if (!resolved) externalImports.add(request);
      } else {
        externalImports.add(request);
      }
    }
  }

  return {
    entry: toPosix(entry),
    files: [...files].sort(),
    externalImports: [...externalImports].sort(),
    nodeBuiltins: [...nodeBuiltins].sort(),
  };
}

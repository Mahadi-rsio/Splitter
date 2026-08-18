import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import type { DependencyScan } from "./types.js";

const JAVASCRIPT_EXTENSIONS = [".js", ".mjs", ".cjs"];
const RESOLUTION_EXTENSIONS = [...JAVASCRIPT_EXTENSIONS, ".json", ".wasm"];
const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
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

function moduleName(importPath: string): string {
  if (importPath.startsWith("node:")) return importPath.slice(5).split("/")[0];
  return importPath.split("/")[0].startsWith("@")
    ? importPath.split("/").slice(0, 2).join("/")
    : importPath.split("/")[0];
}

function isNodeBuiltin(importPath: string): boolean {
  return NODE_BUILTINS.has(moduleName(importPath));
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

function resolveRelativeImport(root: string, fromFile: string, request: string): string | undefined {
  const base = normalize(join(dirname(fromFile), request));
  const candidates = [
    base,
    ...RESOLUTION_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...RESOLUTION_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
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
 * Scans bundled JavaScript without executing it. Relative imports are resolved
 * into the build output; package and Node imports are retained as metadata.
 */
export function scanJavaScriptDependencies(
  root: string,
  entry: string,
): DependencyScan {
  const roots = existsSync(join(root, entry)) && lstatSync(join(root, entry)).isDirectory()
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
        nodeBuiltins.add(request.startsWith("node:") ? request : `node:${request}`);
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
    entry: toPosix(relative(root, join(root, entry))),
    files: [...files].sort(),
    externalImports: [...externalImports].sort(),
    nodeBuiltins: [...nodeBuiltins].sort(),
  };
}
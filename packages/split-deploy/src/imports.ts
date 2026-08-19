/**
 * Real dependency scanner and resolver.
 *
 * Builds a per-file dependency graph by statically analyzing JavaScript
 * imports (import/export/require/dynamic import), resolving relative and
 * package imports against the real node_modules layout of the OpenNext
 * build output, and recording:
 *   - direct + transitive file dependencies
 *   - external package dependencies
 *   - Node builtin usage (normalized to `node:` form)
 *   - native *.node binaries reached through the closure
 *
 * Everything is cached (per-file scans and per-entry closures) so that
 * multiple routes sharing dependencies do not rescan the same file.
 */
import { existsSync, lstatSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import {
  FRAMEWORK_EXTERNALS,
  NODE_BUILTINS,
  isBlockedBuiltin,
  isBlockedPackage,
  isFrameworkPackage,
  packageNameOf,
} from "./blocked-modules.js";
import { findNativeFilesInPackage, owningPackageOf } from "./native-scanner.js";
import type {
  DependencyNode,
  DependencyScan,
  NativeFileInfo,
  RouteClosure,
} from "./types.js";

const JAVASCRIPT_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx"];
const RESOLUTION_EXTENSIONS = [...JAVASCRIPT_EXTENSIONS, ".json", ".wasm"];

const NODE_BUILTIN_SUBPATHS = new Set([
  "node:fs/promises",
  "node:stream/web",
  "node:stream/promises",
  "node:stream/consumers",
  "node:util/types",
  "node:timers/promises",
  "node:dns/promises",
  "node:readline/promises",
]);

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

function isJavaScript(file: string): boolean {
  const ext = extname(file);
  return JAVASCRIPT_EXTENSIONS.includes(ext) || file.endsWith(".json");
}

function isNative(file: string): boolean {
  return file.endsWith(".node");
}

/** Normalizes a Node builtin request to its canonical `node:` form. */
export function normalizeBuiltin(request: string): string | undefined {
  if (request.startsWith("node:")) return request;
  const nodeForm = `node:${request}`;
  if (NODE_BUILTINS.has(nodeForm) || NODE_BUILTIN_SUBPATHS.has(nodeForm)) {
    return nodeForm;
  }
  const head = request.split("/")[0];
  if (NODE_BUILTINS.has(`node:${head}`)) return nodeForm;
  return undefined;
}

/**
 * Extracts import requests from JavaScript source without executing it.
 * Handles static and dynamic import/export/require statements plus the
 * webpack chunk-loading pattern `X(id,[chunkIds],...)` used by the Next.js
 * server runtime and the dynamic `require("./chunks/" + expr)` loader.
 */
export function importsFrom(source: string): string[] {
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

  // webpack runtime chunk loading: `X(0,[873],...)` / `.X(0,[873],...)`
  // and static chunk requires `require("./chunks/873.js")`.
  const chunkPatterns = [
    /\.X\(\s*\d+\s*,\s*\[([0-9,]+)\]\s*,/g,
    /X\(\s*\d+\s*,\s*\[([0-9,]+)\]\s*,/g,
    /require\(\s*["']\.\/chunks\/([0-9]+)\.js["']\s*\)/g,
  ];
  for (const pattern of chunkPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        for (const id of match[1].split(",")) {
          if (id.trim().length > 0) imports.add(`./chunks/${id.trim()}.js`);
        }
      }
    }
  }

  // Dynamic chunk directory load: `require("./chunks/" + expr)`.
  if (/require\(\s*["']\.\/chunks\/["']\s*\+/.test(source)) {
    imports.add("./chunks/*");
  }

  return [...imports];
}

interface ResolvedImport {
  kind: "builtin" | "file" | "external" | "framework";
  file?: string;
  package?: string;
  native?: boolean;
}

/**
 * Finds the node_modules package directory that would resolve `pkgName`
 * from the location of `fromFile` by walking up parent directories.
 */
function findNodeModulesDir(
  root: string,
  fromFile: string,
  pkgName: string,
): string | undefined {
  let dir = dirname(fromFile);
  while (dir.length > 0) {
    const candidate = join(dir, "node_modules", pkgName);
    if (existsSync(join(root, candidate))) {
      return toPosix(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir || !parent) break;
    dir = parent;
  }
  return undefined;
}

function resolveWithExtensions(root: string, base: string): string | undefined {
  const candidates = [
    base,
    ...RESOLUTION_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...RESOLUTION_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    const abs = join(root, candidate);
    if (existsSync(abs) && lstatSync(abs).isFile()) {
      return toPosix(candidate);
    }
  }
  return undefined;
}

function resolvePackageEntry(
  root: string,
  packageDir: string,
): string | undefined {
  let pkgJson: Record<string, unknown> | undefined;
  try {
    pkgJson = JSON.parse(
      readFileSync(join(root, packageDir, "package.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    pkgJson = undefined;
  }

  const tryExports = (exportsValue: unknown): string | undefined => {
    if (typeof exportsValue === "string") {
      return resolveWithExtensions(root, join(packageDir, exportsValue));
    }
    if (exportsValue && typeof exportsValue === "object") {
      const obj = exportsValue as Record<string, unknown>;
      const dot = obj["."];
      if (typeof dot === "string") {
        return resolveWithExtensions(root, join(packageDir, dot));
      }
      if (dot && typeof dot === "object") {
        const conds = dot as Record<string, unknown>;
        for (const key of ["require", "import", "default", "node"]) {
          if (typeof conds[key] === "string") {
            const resolved = resolveWithExtensions(root, join(packageDir, conds[key] as string));
            if (resolved) return resolved;
          }
        }
      }
    }
    return undefined;
  };

  const viaExports = tryExports(pkgJson?.exports);
  if (viaExports) return viaExports;

  const main = pkgJson?.main;
  if (typeof main === "string") {
    const resolved = resolveWithExtensions(root, join(packageDir, main));
    if (resolved) return resolved;
  }

  return resolveWithExtensions(root, join(packageDir, "index.js"));
}

function resolvePackageSubpath(
  root: string,
  packageDir: string,
  subpath: string,
): string | undefined {
  return resolveWithExtensions(root, join(packageDir, subpath));
}

function resolveRequest(
  root: string,
  fromFile: string,
  request: string,
): ResolvedImport {
  if (normalizeBuiltin(request)) {
    return { kind: "builtin" };
  }

  if (request.startsWith(".") || request.startsWith("/") || request.startsWith("~")) {
    if (request.endsWith("/*")) {
      // webpack dynamic chunk directory
      const base = normalize(join(dirname(fromFile), request.slice(0, -2)));
      const abs = join(root, base);
      if (existsSync(abs) && lstatSync(abs).isDirectory()) {
        return { kind: "file", file: toPosix(base) + "/" };
      }
      return { kind: "external" };
    }

    const base = normalize(join(dirname(fromFile), request));
    const resolved = resolveWithExtensions(root, base);
    if (resolved) {
      return {
        kind: "file",
        file: resolved,
        package: owningPackageOf(resolved),
        native: isNative(resolved),
      };
    }
    return { kind: "external" };
  }

  // Bare package import.
  const pkg = packageNameOf(request);
  const framework = isFrameworkPackage(pkg);

  const packageDir = findNodeModulesDir(root, fromFile, pkg);
  if (!packageDir) {
    return {
      kind: framework ? "framework" : "external",
      package: pkg,
    };
  }

  const subpath = request === pkg ? "" : request.slice(pkg.length + 1);
  const resolved = subpath
    ? resolvePackageSubpath(root, packageDir, subpath)
    : resolvePackageEntry(root, packageDir);

  if (resolved) {
    return {
      kind: "file",
      file: resolved,
      package: pkg,
      native: isNative(resolved),
    };
  }
  // The package directory exists but has no resolvable entry — keep it as an
  // external package reference so the closure can still record its native
  // binaries and blocked-package status.
  return { kind: "external", package: pkg };
}

export interface ClosureOptions {
  /** Resolve framework packages (next, react, ...) to their real files. */
  includeFramework?: boolean;
}

export class DependencyScanner {
  readonly root: string;
  private nodeCache = new Map<string, DependencyNode>();
  private closureCache = new Map<string, RouteClosure>();
  private packageNativeCache = new Map<string, NativeFileInfo[]>();

  constructor(root: string) {
    this.root = root;
  }

  /** Scans a single file. Cached. */
  scanFile(file: string): DependencyNode {
    const cached = this.nodeCache.get(file);
    if (cached) return cached;

    const node: DependencyNode = {
      file,
      package: owningPackageOf(file),
      imports: [],
      resolvedImports: [],
      externalImports: [],
      nodeBuiltins: [],
      nativeFiles: [],
    };

    const abs = join(this.root, file);
    if (existsSync(abs) && lstatSync(abs).isFile() && isJavaScript(file)) {
      try {
        const source = readFileSync(abs, "utf8");
        for (const request of importsFrom(source)) {
          node.imports.push(request);
          const resolved = resolveRequest(this.root, file, request);
          if (resolved.kind === "builtin") {
            node.nodeBuiltins.push(normalizeBuiltin(request)!);
          } else if (resolved.kind === "file") {
            if (resolved.file!.endsWith("/")) {
              for (const df of this.listDirectoryFiles(resolved.file!)) {
                if (!node.resolvedImports.includes(df)) node.resolvedImports.push(df);
              }
            } else {
              node.resolvedImports.push(resolved.file!);
              if (resolved.native) node.nativeFiles.push(resolved.file!);
            }
          } else if (resolved.kind === "framework") {
            // Recorded at closure level.
          } else {
            node.externalImports.push(request);
          }
        }
      } catch {
        // Unreadable files are tolerated — the graph simply has no edges.
      }
    }

    node.nodeBuiltins = [...new Set(node.nodeBuiltins)].sort();
    node.resolvedImports = [...new Set(node.resolvedImports)].sort();
    node.externalImports = [...new Set(node.externalImports)].sort();
    node.nativeFiles = [...new Set(node.nativeFiles)].sort();
    this.nodeCache.set(file, node);
    return node;
  }

  private listDirectoryFiles(dir: string): string[] {
    const abs = join(this.root, dir);
    try {
      return readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => toPosix(join(dir, e.name)));
    } catch {
      return [];
    }
  }

  /** Native binaries shipped by a package directory. Cached. */
  packageNativeFiles(packageDir: string): NativeFileInfo[] {
    const cached = this.packageNativeCache.get(packageDir);
    if (cached) return cached;
    const natives = findNativeFilesInPackage(this.root, packageDir);
    this.packageNativeCache.set(packageDir, natives);
    return natives;
  }

  /**
   * Locates the directory of an installed package by searching for
   * `node_modules/<name>` anywhere under the build root (node_modules may be
   * nested, e.g. `server-functions/default/node_modules/`).
   */
  private findPackageDir(name: string): string | undefined {
    if (!name || name === "." || name === ".." || name.includes("/") && name.split("/").length < 2 && !name.startsWith("@")) {
      return undefined;
    }
    const roots = ["node_modules", "server-functions", "functions", "nodejs"];
    const visited = new Set<string>();
    const queue: string[] = [];

    for (const base of roots) {
      if (existsSync(join(this.root, base)) && lstatSync(join(this.root, base)).isDirectory()) {
        queue.push(base);
      }
    }

    // BFS for any `node_modules/<name>` directory (node_modules can be nested
    // at varying depths: node_modules/, server-functions/default/node_modules/).
    while (queue.length > 0) {
      const current = queue.shift()!;
      const candidate = `${current}/node_modules/${name}`;
      if (
        existsSync(join(this.root, candidate)) &&
        lstatSync(join(this.root, candidate)).isDirectory()
      ) {
        return toPosix(candidate);
      }
      if (visited.has(current)) continue;
      visited.add(current);
      let entries: Dirent[];
      try {
        entries = readdirSync(join(this.root, current), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory()) queue.push(`${current}/${e.name}`);
      }
    }

    return undefined;
  }

  /**
   * Walks a node_modules package directory and its declared dependencies,
   * returning all JS/native files within. Used to materialize the complete
   * runtime for Lambda closures where webpack-compiled framework code loads
   * modules by internal IDs that static analysis cannot resolve.
   */
  private walkPackageTree(pkgName: string): {
    files: string[];
    packages: string[];
  } {
    const files = new Set<string>();
    const packages = new Set<string>();
    const queue = [pkgName];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const name = queue.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);

      const pkgDir = this.findPackageDir(name);
      if (!pkgDir) continue;
      const abs = join(this.root, pkgDir);
      packages.add(name);

      const walkDir = (rel: string): void => {
        let entries: Dirent[];
        try {
          entries = readdirSync(join(this.root, rel), { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const childRel = `${rel}/${e.name}`;
          if (e.isDirectory()) {
            walkDir(childRel);
          } else if (e.isFile() && (isJavaScript(childRel) || isNative(childRel))) {
            files.add(toPosix(childRel));
          }
        }
      };
      walkDir(pkgDir);

      // Include declared dependencies so the runtime can resolve its peers.
      try {
        const pkgJson = JSON.parse(
          readFileSync(join(abs, "package.json"), "utf8"),
        ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
        const deps = {
          ...(pkgJson.dependencies ?? {}),
          ...(pkgJson.peerDependencies ?? {}),
        };
        for (const dep of Object.keys(deps)) {
          if (this.findPackageDir(dep)) queue.push(dep);
        }
      } catch {
        // Missing/invalid package.json is tolerated.
      }
    }

    return { files: [...files], packages: [...packages] };
  }

  /**
   * Computes the complete transitive closure for an entrypoint.
   * Dependency edges are preserved in the per-file nodes. Framework package
   * files are only traversed when `includeFramework` is set.
   */
  closure(entry: string, opts: ClosureOptions = {}): RouteClosure {
    const includeFramework = opts.includeFramework ?? false;
    const cacheKey = `${includeFramework ? "F" : "W"}:${entry}`;
    const cached = this.closureCache.get(cacheKey);
    if (cached) return cached;

    const files = new Set<string>();
    const packages = new Set<string>();
    const frameworkPackages = new Set<string>();
    const nodeBuiltins = new Set<string>();
    const nativeFiles = new Map<string, NativeFileInfo>();
    const unresolved = new Set<string>();
    const parent = new Map<string, string | undefined>();
    let firstBlockingFile: string | undefined;

    const start = toPosix(entry);
    const queue: string[] = [];
    if (existsSync(join(this.root, start)) && lstatSync(join(this.root, start)).isDirectory()) {
      for (const f of this.listDirectoryFiles(start)) {
        if (isJavaScript(f) || isNative(f)) {
          files.add(f);
          parent.set(f, start);
          queue.push(f);
        }
      }
    } else {
      files.add(start);
      parent.set(start, undefined);
      queue.push(start);
    }

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (isNative(file)) {
        const pkg = owningPackageOf(file) ?? "<unknown>";
        nativeFiles.set(file, { path: file, package: pkg, reason: "native-addon" });
        if (!firstBlockingFile) firstBlockingFile = file;
        continue;
      }
      if (!isJavaScript(file)) continue;

      const node = this.scanFile(file);
      const nodePackage = node.package;
      if (nodePackage) {
        const pkgName = packageNameOf(nodePackage);
        if (isFrameworkPackage(pkgName)) {
          if (includeFramework) packages.add(pkgName);
        } else {
          packages.add(pkgName);
        }
      }
      for (const b of node.nodeBuiltins) {
        nodeBuiltins.add(b);
        if (isBlockedBuiltin(b) && !firstBlockingFile) firstBlockingFile = file;
      }
      for (const f of node.nativeFiles) {
        if (!firstBlockingFile) firstBlockingFile = file;
      }
      for (const u of node.externalImports) {
        unresolved.add(u);
        // Register packages with an installed directory (even without a
        // resolvable entry) so their native binaries and blocked status are
        // captured in the closure. Only bare package specifiers qualify —
        // unresolved relative/absolute paths are not packages.
        const pkg = packageNameOf(u);
        if (
          !u.startsWith(".") &&
          !u.startsWith("/") &&
          !u.startsWith("~") &&
          !normalizeBuiltin(u) &&
          this.findPackageDir(pkg)
        ) {
          if (isFrameworkPackage(pkg)) {
            if (includeFramework) packages.add(pkg);
          } else {
            packages.add(pkg);
          }
        }
      }

      for (const f of node.resolvedImports) {
        const nodeModulesAt = f.indexOf("/node_modules/");
        const isFrameworkFile =
          nodeModulesAt >= 0 &&
          isFrameworkPackage(
            packageNameOf(f.slice(nodeModulesAt + "/node_modules/".length)),
          );

        if (isFrameworkFile && !includeFramework) {
          const pkgName = packageNameOf(f.slice(nodeModulesAt + "/node_modules/".length));
          frameworkPackages.add(pkgName);
          continue;
        }
        if (!files.has(f)) {
          files.add(f);
          parent.set(f, file);
          queue.push(f);
        }
      }
    }

    // Framework packages referenced from within the closure.
    for (const node of this.nodeCache.values()) {
      if (!files.has(node.file)) continue;
      for (const request of node.imports) {
        const pkg = packageNameOf(request);
        if (isFrameworkPackage(pkg)) frameworkPackages.add(pkg);
      }
    }

    // Materialize the full framework runtime when requested: webpack-compiled
    // framework code loads peers by internal IDs, so we walk the package tree
    // (the framework package plus its declared dependencies) to bring in
    // react, react-dom, styled-jsx, @swc/helpers, and so on.
    if (includeFramework) {
      for (const pkgName of [...frameworkPackages, ...packages]) {
        if (!isFrameworkPackage(packageNameOf(pkgName))) continue;
        const tree = this.walkPackageTree(packageNameOf(pkgName));
        for (const f of tree.files) {
          if (!files.has(f)) {
            files.add(f);
            parent.set(f, undefined);
            queue.push(f);
          }
        }
        for (const p of tree.packages) packages.add(p);
      }
      // Re-process the newly added files.
      while (queue.length > 0) {
        const file = queue.pop()!;
        if (isNative(file)) continue;
        if (!isJavaScript(file)) continue;
        const node = this.scanFile(file);
        for (const f of node.resolvedImports) {
          if (!files.has(f)) {
            files.add(f);
            parent.set(f, file);
            queue.push(f);
          }
        }
        for (const b of node.nodeBuiltins) {
          nodeBuiltins.add(b);
          if (isBlockedBuiltin(b) && !firstBlockingFile) firstBlockingFile = file;
        }
        for (const u of node.externalImports) unresolved.add(u);
      }
    }

    // Native files shipped by included packages (build/Release, prebuilds, napi-*).
    for (const pkgName of packages) {
      const pkgDir = this.findPackageDir(pkgName);
      if (!pkgDir) continue;
      for (const nf of this.packageNativeFiles(pkgDir)) {
        if (!nativeFiles.has(nf.path)) nativeFiles.set(nf.path, nf);
      }
    }

    const blockedBuiltins = [...nodeBuiltins].filter((b) => isBlockedBuiltin(b)).sort();
    const blockedPackages = [...packages].filter((p) => isBlockedPackage(p)).sort();

    const chain = this.buildChain(parent, firstBlockingFile, {
      builtins: blockedBuiltins,
      natives: [...nativeFiles.values()].map((n) => n.path),
      packages: blockedPackages,
      entry: start,
    });

    const closure: RouteClosure = {
      entry: start,
      files: [...files].sort(),
      packages: [...packages].sort(),
      frameworkPackages: [...frameworkPackages].sort(),
      nodeBuiltins: [...nodeBuiltins].sort(),
      blockedBuiltins,
      blockedPackages,
      nativeFiles: [...nativeFiles.values()].sort((a, b) => a.path.localeCompare(b.path)),
      unresolved: [...unresolved].sort(),
      chain,
    };

    this.closureCache.set(cacheKey, closure);
    return closure;
  }

  private buildChain(
    parent: Map<string, string | undefined>,
    firstBlockingFile: string | undefined,
    blocking: { builtins: string[]; natives: string[]; packages: string[]; entry: string },
  ): string[] {
    if (!firstBlockingFile) return [];
    const path: string[] = [];
    let current: string | undefined = firstBlockingFile;
    const visited = new Set<string>();
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      path.unshift(current);
      current = parent.get(current);
    }
    const firstCause = [...blocking.natives, ...blocking.builtins, ...blocking.packages][0];
    if (firstCause) path.push(firstCause);
    return path;
  }
}

/**
 * Legacy convenience function — scans a single entry and returns the
 * shallow dependency scan shape used by older callers.
 */
export function scanJavaScriptDependencies(
  root: string,
  entry: string,
): DependencyScan {
  const scanner = new DependencyScanner(root);
  const closure = scanner.closure(entry, { includeFramework: true });
  return {
    entry: closure.entry,
    files: closure.files,
    externalImports: closure.unresolved,
    nodeBuiltins: closure.nodeBuiltins,
  };
}

/** Convenience function that builds a closure for a single entry. */
export function computeClosure(
  root: string,
  entry: string,
  opts: ClosureOptions = {},
): RouteClosure {
  return new DependencyScanner(root).closure(entry, opts);
}
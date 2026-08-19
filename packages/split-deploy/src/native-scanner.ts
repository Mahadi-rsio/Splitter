/**
 * Native addon detection.
 *
 * Scans the OpenNext build output for compiled Node addons (*.node) and maps
 * them back to the npm package that owns them. A route whose dependency
 * closure reaches any of these binaries must run on Lambda — this is detected
 * by file inspection, not just by package name denylists.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packageNameOf } from "./blocked-modules.js";
import type { NativeFileInfo } from "./types.js";

const NATIVE_LOCATIONS = ["build/Release", "prebuilds", "build", "lib", "bin"];

function walk(root: string, dir: string): string[] {
  let result: string[] = [];
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      result = result.concat(walk(root, `${dir}/${entry.name}`));
    } else if (entry.isFile()) {
      result.push(`${dir}/${entry.name}`);
    }
  }
  return result;
}

/** Returns the node_modules package directory that owns `file`, if any. */
export function packageDirOf(file: string): string | undefined {
  const idx = file.lastIndexOf("node_modules/");
  if (idx === -1) return undefined;
  const rest = file.slice(idx + "node_modules/".length);
  const parts = rest.split("/");
  if (parts.length < 1) return undefined;
  if (parts[0].startsWith("@")) {
    return parts.length >= 2 ? `node_modules/${parts[0]}/${parts[1]}` : undefined;
  }
  return `node_modules/${parts[0]}`;
}

/** Returns the owning package name for a file under node_modules. */
export function owningPackageOf(file: string): string | undefined {
  const dir = packageDirOf(file);
  return dir ? packageNameOf(dir.replace(/^node_modules\//, "")) : undefined;
}

/**
 * Scans every *.node file in the build and returns metadata about each one.
 */
export function scanNativeFiles(root: string): NativeFileInfo[] {
  const files = walk(root, "");
  const natives: NativeFileInfo[] = [];
  for (const file of files) {
    if (!file.endsWith(".node")) continue;
    const pkg = owningPackageOf(file);
    natives.push({
      path: file,
      package: pkg ?? "<unknown>",
      reason: "native-addon",
    });
  }
  return natives.sort((a, b) => a.path.localeCompare(b.path));
}

/** Returns the set of package names that own at least one .node binary. */
export function packagesWithNativeFiles(natives: NativeFileInfo[]): Set<string> {
  return new Set(natives.map((n) => n.package));
}

/**
 * Scans a specific package directory for native binaries.
 * Used after a package is pulled into a route closure to check whether it
 * ships compiled addons.
 */
export function findNativeFilesInPackage(
  root: string,
  packageDir: string,
): NativeFileInfo[] {
  const pkg = owningPackageOf(`${packageDir}/index.js`) ?? packageNameOf(packageDir);
  const natives: NativeFileInfo[] = [];
  const seen = new Set<string>();
  for (const location of NATIVE_LOCATIONS) {
    const files = walk(root, `${packageDir}/${location}`);
    for (const file of files) {
      if (file.endsWith(".node") && !seen.has(file)) {
        seen.add(file);
        natives.push({
          path: file,
          package: pkg,
          reason: "native-addon",
        });
      }
    }
  }
  // Also catch top-level and napi-*.node files anywhere in the package.
  const all = walk(root, packageDir);
  for (const file of all) {
    if (file.endsWith(".node") && !seen.has(file)) {
      seen.add(file);
      natives.push({
        path: file,
        package: pkg,
        reason: "native-addon",
      });
    }
  }
  return natives;
}

/** Reads a package.json from a node_modules package directory. */
export function readPackageJson(
  root: string,
  packageDir: string,
): Record<string, unknown> | undefined {
  try {
    const raw = readFileSync(join(root, packageDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
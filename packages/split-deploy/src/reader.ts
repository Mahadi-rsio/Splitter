import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import type { OpenNextBuild, OpenNextManifest } from "./types.js";

const JAVASCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const ASSET_DIRECTORIES = ["assets", "static", "public"];
const WORKER_FILE_NAMES = new Set([
  "worker.js",
  "worker.mjs",
  "middleware.js",
  "middleware.mjs",
]);

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

function walk(root: string, current = root): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(root, absolute));
    } else if (entry.isFile()) {
      result.push(toPosix(relative(root, absolute)));
    }
  }
  return result;
}

function readManifest(root: string, file: string): OpenNextManifest | undefined {
  try {
    const data = JSON.parse(readFileSync(join(root, file), "utf8")) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return { file, data: data as Record<string, unknown> };
    }
  } catch {
    // A file with a manifest name but invalid JSON is reported as a warning by
    // the caller only when it is needed. The reader remains usable for builds
    // that do not include every Next.js manifest.
  }
  return undefined;
}

function isJavaScript(file: string): boolean {
  return JAVASCRIPT_EXTENSIONS.has(file.slice(file.lastIndexOf(".")));
}

function collectEntries(files: string[], prefix: string): string[] {
  return files.filter(
    (file) => file.startsWith(`${prefix}/`) && isJavaScript(file),
  );
}

/**
 * Reads the parts of an OpenNext output that are useful to a split build.
 *
 * The reader intentionally accepts both current and older OpenNext layouts:
 * manifests are found by filename, while worker and server-function entries
 * are detected by their conventional directory/file names.
 */
export function readOpenNextBuild(inputDir: string): OpenNextBuild {
  const root = inputDir;
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`OpenNext output directory does not exist: ${root}`);
  }

  const files = walk(root);
  const manifests = files
    .filter((file) =>
      new Set([
        "routes-manifest.json",
        "middleware-manifest.json",
        "app-build-manifest.json",
        "build-manifest.json",
      ]).has(file.split("/").at(-1) ?? ""),
    )
    .map((file) => readManifest(root, file))
    .filter((manifest): manifest is OpenNextManifest => manifest !== undefined);

  const assetFiles = files.filter((file) =>
    ASSET_DIRECTORIES.some(
      (directory) => file === directory || file.startsWith(`${directory}/`),
    ),
  );

  const workerEntries = files.filter((file) => {
    const basename = file.split("/").at(-1) ?? "";
    return (
      WORKER_FILE_NAMES.has(basename) ||
      file.startsWith("middleware/") ||
      file.includes("/middleware/")
    );
  });

  const serverFunctions = collectEntries(files, "server-functions");
  const lambdaEntries = serverFunctions.filter(
    (file) => !/(^|\/)(edge|worker|middleware)([-_.\/]|$)/i.test(file),
  );

  return {
    root,
    files,
    manifests,
    assetFiles,
    workerEntries: [...new Set(workerEntries)].sort(),
    lambdaEntries: [...new Set(lambdaEntries)].sort(),
  };
}

export function readJsonFile(root: string, file: string): unknown {
  return JSON.parse(readFileSync(join(root, file), "utf8")) as unknown;
}

export function isDirectory(root: string, file: string): boolean {
  return existsSync(join(root, file)) && lstatSync(join(root, file)).isDirectory();
}

export function listFilesUnder(root: string, directory: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute) || !lstatSync(absolute).isDirectory()) return [];
  return walk(absolute).map((file) => toPosix(join(directory, file)));
}
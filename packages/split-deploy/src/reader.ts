import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import type { OpenNextBuild, OpenNextManifest, ServerFunction } from "./types.js";

const JAVASCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const ASSET_DIRECTORIES = ["assets", "static", "public"];
const WORKER_FILE_NAMES = new Set([
  "worker.js",
  "worker.mjs",
  "middleware.js",
  "middleware.mjs",
]);
const MANIFEST_NAMES = new Set([
  "routes-manifest.json",
  "middleware-manifest.json",
  "app-build-manifest.json",
  "build-manifest.json",
  "prerender-manifest.json",
  "app-paths-manifest.json",
  "pages-manifest.json",
  "server-reference-manifest.json",
  "next-server.js.nft.json",
  "app-path-routes-manifest.json",
  "functions-config-manifest.json",
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
    // Invalid JSON is tolerated — not all builds contain every manifest.
  }
  return undefined;
}

function isJavaScript(file: string): boolean {
  return JAVASCRIPT_EXTENSIONS.has(file.slice(file.lastIndexOf(".")));
}

function detectServerFunctions(root: string, files: string[]): ServerFunction[] {
  const serverFunctionsDir = "server-functions";
  if (!existsSync(join(root, serverFunctionsDir))) return [];

  const subdirs = readdirSync(join(root, serverFunctionsDir), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const functions: ServerFunction[] = [];
  for (const name of subdirs) {
    const directory = `${serverFunctionsDir}/${name}`;
    const entrypoint = [`${directory}/index.mjs`, `${directory}/index.js`]
      .find((f) => files.includes(f));
    if (!entrypoint) continue;

    const fnFiles = files.filter((f) => f.startsWith(`${directory}/`));
    functions.push({ name, directory, entrypoint, files: fnFiles });
  }

  // Also check for flat entries (e.g. server-functions/default.js without a subdirectory)
  const flatEntries = files.filter(
    (f) =>
      f.startsWith(`${serverFunctionsDir}/`) &&
      !f.includes("/", serverFunctionsDir.length + 1) &&
      isJavaScript(f),
  );
  for (const entry of flatEntries) {
    const name = entry
      .slice(serverFunctionsDir.length + 1)
      .replace(/\.(m?js|cjs)$/, "");
    if (functions.some((fn) => fn.name === name)) continue;
    functions.push({
      name,
      directory: serverFunctionsDir,
      entrypoint: entry,
      files: [entry],
    });
  }

  return functions;
}

/**
 * Reads an OpenNext output directory into a normalized internal representation.
 * Handles both AWS-style (server-functions/) and Cloudflare-style (worker.js) layouts.
 */
export function readOpenNextBuild(inputDir: string): OpenNextBuild {
  const root = inputDir;
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`OpenNext output directory does not exist: ${root}`);
  }

  const files = walk(root);

  const manifests = files
    .filter((file) => MANIFEST_NAMES.has(file.split("/").at(-1) ?? ""))
    .map((file) => readManifest(root, file))
    .filter((m): m is OpenNextManifest => m !== undefined);

  // Also search inside server-function bundles for manifests
  for (const file of files) {
    const basename = file.split("/").at(-1) ?? "";
    if (
      MANIFEST_NAMES.has(basename) &&
      !manifests.some((m) => m.file === file)
    ) {
      const m = readManifest(root, file);
      if (m) manifests.push(m);
    }
  }

  const assetFiles = files.filter((file) =>
    ASSET_DIRECTORIES.some(
      (dir) => file === dir || file.startsWith(`${dir}/`),
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

  const serverFunctions = detectServerFunctions(root, files);

  const lambdaEntries = serverFunctions.map((fn) => fn.entrypoint);

  return {
    root,
    files,
    manifests,
    assetFiles,
    serverFunctions,
    workerEntries: [...new Set(workerEntries)].sort(),
    lambdaEntries: [...new Set(lambdaEntries)].sort(),
  };
}

export function readJsonFile(root: string, file: string): unknown {
  return JSON.parse(readFileSync(join(root, file), "utf8")) as unknown;
}

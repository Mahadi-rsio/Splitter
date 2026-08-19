import type {
  OpenNextBuild,
  OpenNextManifest,
  RouteDefinition,
  RouteKind,
  RuntimeHint,
} from "./types.js";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function runtimeHint(value: unknown): RuntimeHint {
  const runtime = stringValue(value)?.toLowerCase();
  if (runtime && /(edge|worker|experimental-edge)/.test(runtime)) return "edge";
  if (runtime && /(node|lambda|server)/.test(runtime)) return "node";
  return "unknown";
}

function routeKind(path: string, rawType?: unknown): RouteKind {
  const explicit = stringValue(rawType)?.toLowerCase();
  if (explicit === "middleware") return "middleware";
  if (explicit === "api" || explicit === "route") return "api";
  if (explicit === "static") return "static";
  if (explicit === "prerendered") return "prerendered";
  if (explicit === "dynamic" || explicit === "server") return "server";
  if (path.startsWith("/api/") || path === "/api") return "api";
  if (/\[[^/]+\]/.test(path) || path.includes(":")) return "server";
  return "static";
}

function pathValue(raw: Record<string, unknown>): string | undefined {
  return (
    stringValue(raw.path) ??
    stringValue(raw.route) ??
    stringValue(raw.page) ??
    stringValue(raw.pathname) ??
    stringValue(raw.regex)
  );
}

function entryValue(raw: Record<string, unknown>): string | undefined {
  return (
    stringValue(raw.entry) ??
    stringValue(raw.file) ??
    (Array.isArray(raw.files)
      ? raw.files.find((file): file is string => typeof file === "string")
      : undefined)
  );
}

function addRoute(
  routes: Map<string, RouteDefinition>,
  path: string | undefined,
  raw: Record<string, unknown> = {},
  defaults: Partial<RouteDefinition> = {},
): void {
  if (!path || path.startsWith("regex:")) return;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const next: RouteDefinition = {
    path: normalized,
    kind: defaults.kind ?? routeKind(normalized, raw.type),
    runtime: defaults.runtime ?? runtimeHint(raw.runtime),
    entry: entryValue(raw) ?? defaults.entry,
    source: defaults.source,
    chunks: [],
  };
  const existing = routes.get(normalized);
  routes.set(normalized, {
    ...existing,
    ...next,
    entry: next.entry ?? existing?.entry,
    chunks: [...(existing?.chunks ?? []), ...next.chunks],
    runtime:
      next.runtime !== "unknown" ? next.runtime : existing?.runtime ?? "unknown",
  });
}

function addCollection(
  routes: Map<string, RouteDefinition>,
  value: unknown,
  defaults: Partial<RouteDefinition> = {},
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") addRoute(routes, item, {}, defaults);
      else if (item && typeof item === "object") {
        const raw = item as Record<string, unknown>;
        addRoute(routes, pathValue(raw), raw, defaults);
      }
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [path, item] of Object.entries(value)) {
      const raw =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      addRoute(routes, path, raw, defaults);
    }
  }
}

/**
 * Extracts prerendered routes from the prerender-manifest.json.
 * These are routes that were statically generated at build time.
 */
function addPrerenderRoutes(
  routes: Map<string, RouteDefinition>,
  manifests: OpenNextManifest[],
): void {
  for (const manifest of manifests) {
    if (!manifest.file.endsWith("prerender-manifest.json")) continue;
    const data = manifest.data;
    if (data.routes && typeof data.routes === "object") {
      for (const path of Object.keys(data.routes as Record<string, unknown>)) {
        addRoute(routes, path, {}, {
          kind: "prerendered",
          source: manifest.file,
        });
      }
    }
  }
}

/**
 * Extracts route information from app-paths-manifest.json
 * which maps route paths to their server-side entrypoints.
 */
function addAppPathRoutes(
  routes: Map<string, RouteDefinition>,
  manifests: OpenNextManifest[],
): void {
  for (const manifest of manifests) {
    if (!manifest.file.endsWith("app-paths-manifest.json")) continue;
    // Resolve entry paths relative to the manifest's parent directories
    // e.g. manifest at server-functions/default/.next/server/app-paths-manifest.json
    // entry "app/api/search/route.js" → server-functions/default/.next/server/app/api/search/route.js
    const manifestDir = manifest.file.split("/").slice(0, -1).join("/");
    for (const [path, entryFile] of Object.entries(manifest.data)) {
      const normalizedPath = path.replace(/\/page$/, "").replace(/\/route$/, "") || "/";
      const isApi = path.endsWith("/route");
      const resolvedEntry = typeof entryFile === "string"
        ? (manifestDir ? `${manifestDir}/${entryFile}` : entryFile)
        : undefined;
      addRoute(routes, normalizedPath, {}, {
        kind: isApi ? "api" : undefined,
        entry: resolvedEntry,
        source: manifest.file,
      });
    }
  }
}

export function detectRoutes(
  manifests: OpenNextManifest[],
  build?: OpenNextBuild,
): RouteDefinition[] {
  const routes = new Map<string, RouteDefinition>();

  for (const manifest of manifests) {
    const data = manifest.data;
    addCollection(routes, data.routes, { source: manifest.file });
    addCollection(routes, data.appRoutes, { source: manifest.file });
    addCollection(routes, data.staticRoutes, {
      kind: "static",
      source: manifest.file,
    });
    addCollection(routes, data.dynamicRoutes, {
      kind: "server",
      source: manifest.file,
    });
    addCollection(routes, data.middleware, {
      kind: "middleware",
      runtime: "edge",
      source: manifest.file,
    });
  }

  addPrerenderRoutes(routes, manifests);
  addAppPathRoutes(routes, manifests);

  // If we have server functions from the build, associate them with routes
  if (build) {
    for (const fn of build.serverFunctions) {
      // Try to match server functions to routes by name
      for (const [, route] of routes) {
        if (!route.entry && fn.name === "default") {
          // Default function handles unmatched routes
        }
      }
    }
  }

  return [...routes.values()].sort((a, b) => a.path.localeCompare(b.path));
}

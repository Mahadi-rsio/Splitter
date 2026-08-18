import type {
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
  if (explicit === "dynamic") return "dynamic";
  if (path.startsWith("/api/") || path === "/api") return "api";
  if (/\[[^/]+\]/.test(path) || path.includes(":")) return "dynamic";
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
  };
  const existing = routes.get(normalized);
  routes.set(normalized, {
    ...existing,
    ...next,
    entry: next.entry ?? existing?.entry,
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

export function detectRoutes(manifests: OpenNextManifest[]): RouteDefinition[] {
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
      kind: "dynamic",
      source: manifest.file,
    });
    addCollection(routes, data.middleware, {
      kind: "middleware",
      runtime: "edge",
      source: manifest.file,
    });
  }

  return [...routes.values()].sort((a, b) => a.path.localeCompare(b.path));
}
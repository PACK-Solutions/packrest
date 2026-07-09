// Structural diff between two versions of an OpenAPI bundle — the single
// implementation shared by the runtime (lib/spec-diff.ts, typed via
// lib/spec-diff-core.d.ts) and the build-time CLI (scripts/copy-specs.mjs).
//
// Plain ESM importing only js-yaml, so the predev/prebuild CLI can require it
// under plain `node` (before any TS build) while the TS re-export keeps
// allowJs:false intact under moduleResolution:bundler.
import yaml from "js-yaml";

export const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
];

// Deterministic JSON: object keys sorted recursively so two semantically equal
// operations (authored in a different key order) stringify identically.
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(",")}}`;
}

export function parseDoc(text) {
  let doc;
  try {
    doc = yaml.load(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const operations = new Map();
  for (const [pathKey, item] of Object.entries(doc.paths ?? {})) {
    if (!item || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      operations.set(`${method.toUpperCase()} ${pathKey}`, stableStringify(op));
    }
  }
  const scopes = new Set();
  for (const scheme of Object.values(doc.components?.securitySchemes ?? {})) {
    const s = scheme?.flows?.clientCredentials?.scopes;
    if (s && typeof s === "object") {
      for (const name of Object.keys(s)) scopes.add(name);
    }
  }
  const version =
    typeof doc.info?.version === "string" ? doc.info.version : undefined;
  return { version, operations, scopes };
}

// Compare the previously-synced bundle (oldYaml, null when the API is new)
// against the freshly-synced one. Never throws: unparseable input degrades to
// a detail-free "updated" rather than breaking the sync. All result arrays are
// returned in stable sorted order.
export function diffSpec(api, oldYaml, newYaml) {
  const next = parseDoc(newYaml);
  const empty = {
    api,
    status: "updated",
    endpointsAdded: [],
    endpointsRemoved: [],
    endpointsChanged: [],
    scopesAdded: [],
    scopesRemoved: [],
  };

  if (oldYaml == null || oldYaml.trim() === "") {
    return { ...empty, status: "added", toVersion: next?.version };
  }
  const prev = parseDoc(oldYaml);
  // If either side is unparseable we can't trust a structural diff — say it
  // changed but skip the (misleading) details.
  if (!prev || !next) {
    return { ...empty, fromVersion: prev?.version, toVersion: next?.version };
  }

  const endpointsAdded = [...next.operations.keys()]
    .filter((k) => !prev.operations.has(k))
    .sort();
  const endpointsRemoved = [...prev.operations.keys()]
    .filter((k) => !next.operations.has(k))
    .sort();
  const endpointsChanged = [...next.operations.keys()]
    .filter(
      (k) =>
        prev.operations.has(k) &&
        prev.operations.get(k) !== next.operations.get(k),
    )
    .sort();
  const scopesAdded = [...next.scopes].filter((s) => !prev.scopes.has(s)).sort();
  const scopesRemoved = [...prev.scopes]
    .filter((s) => !next.scopes.has(s))
    .sort();

  const changed =
    endpointsAdded.length > 0 ||
    endpointsRemoved.length > 0 ||
    endpointsChanged.length > 0 ||
    scopesAdded.length > 0 ||
    scopesRemoved.length > 0 ||
    prev.version !== next.version;

  return {
    api,
    status: changed ? "updated" : "unchanged",
    fromVersion: prev.version,
    toVersion: next.version,
    endpointsAdded,
    endpointsRemoved,
    endpointsChanged,
    scopesAdded,
    scopesRemoved,
  };
}

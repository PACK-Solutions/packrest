import yaml from "js-yaml";
import { HTTP_METHODS } from "./types";

// Structural diff between two versions of an OpenAPI bundle, computed at sync
// time by capturing the previous <api>.yaml before it's overwritten. Both sync
// paths (lib/sync.ts, lib/gitlab.ts) call diffSpec so the UI can report what
// actually moved instead of just "synced N". Single runtime implementation —
// there is no build-time CLI consumer.

export interface SpecDiff {
  api: string;
  status: "added" | "updated" | "unchanged";
  fromVersion?: string;
  toVersion?: string;
  /** "GET /factures" entries, sorted. */
  endpointsAdded: string[];
  endpointsRemoved: string[];
  /** Operation object changed (params, body, responses, scopes, summary…). */
  endpointsChanged: string[];
  scopesAdded: string[];
  scopesRemoved: string[];
}

interface ParsedDoc {
  version?: string;
  /** "METHOD /path" -> stable JSON of the operation object. */
  operations: Map<string, string>;
  scopes: Set<string>;
}

// Deterministic JSON: object keys sorted recursively so two semantically equal
// operations (authored in a different key order) stringify identically.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function parseDoc(text: string): ParsedDoc | null {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const d = doc as {
    info?: { version?: unknown };
    paths?: Record<string, Record<string, unknown>>;
    components?: {
      securitySchemes?: Record<
        string,
        { type?: string; flows?: { clientCredentials?: { scopes?: object } } }
      >;
    };
  };

  const operations = new Map<string, string>();
  for (const [pathKey, item] of Object.entries(d.paths ?? {})) {
    if (!item || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = (item as Record<string, unknown>)[method];
      if (!op) continue;
      operations.set(
        `${method.toUpperCase()} ${pathKey}`,
        stableStringify(op),
      );
    }
  }

  const scopes = new Set<string>();
  for (const scheme of Object.values(d.components?.securitySchemes ?? {})) {
    const s = scheme?.flows?.clientCredentials?.scopes;
    if (s && typeof s === "object") {
      for (const name of Object.keys(s)) scopes.add(name);
    }
  }

  const version =
    typeof d.info?.version === "string" ? d.info.version : undefined;
  return { version, operations, scopes };
}

// Compare the previously-synced bundle (oldYaml, null when the API is new)
// against the freshly-synced one. Never throws: unparseable input degrades to
// a detail-free "updated" rather than breaking the sync. All result arrays are
// returned in stable sorted order.
export function diffSpec(
  api: string,
  oldYaml: string | null,
  newYaml: string,
): SpecDiff {
  const next = parseDoc(newYaml);
  const empty: SpecDiff = {
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
  const scopesAdded = [...next.scopes]
    .filter((s) => !prev.scopes.has(s))
    .sort();
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

// Client-side OpenAPI spec loader. Reads YAML bundles from the writable spec
// store (lib/specs-fs — tauri-plugin-fs in Tauri, bundled static assets in a
// plain browser), parses + dereferences them, and caches in module memory.
// Mirrors the surface of the former server-only node:fs loader; the read is
// now async and I/O-agnostic, while the parsing/deref and the pure endpoint
// walkers are unchanged.

import yaml from "js-yaml";
import type {
  ApiSummary,
  OpenApiDocument,
  OpenApiOperation,
  OAuth2Scheme,
  PathItem,
  HttpMethodLower,
} from "./types";
import { HTTP_METHODS } from "./types";
import { dereference } from "./deref";
import constants from "./sync-constants.json";
import { listSpecFiles, readSpecFile } from "./specs-fs";

const EXCLUDED_APIS: string[] = constants.EXCLUDED_APIS;

// Dispatched on the window after the spec store changes (a sync wrote new
// bundles and busted the cache), so the API grid / sidebar re-load without a
// full navigation.
export const SPECS_CHANGED_EVENT = "packrest:specs-changed";

const docCache = new Map<string, OpenApiDocument>();
let listCache: string[] | null = null;

export function resetSpecCache(): void {
  docCache.clear();
  listCache = null;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(SPECS_CHANGED_EVENT));
}

export async function listApis(): Promise<string[]> {
  if (listCache) return listCache;
  try {
    const ids = await listSpecFiles();
    listCache = ids
      // Defensive: hide deprecated / merged APIs even if a stale file lingers.
      .filter((id) => !EXCLUDED_APIS.includes(id))
      .sort();
  } catch {
    listCache = [];
  }
  return listCache;
}

export async function loadSpec(apiId: string): Promise<OpenApiDocument | null> {
  const cached = docCache.get(apiId);
  if (cached) return cached;
  const raw = await readSpecFile(apiId);
  if (raw == null) return null;
  const parsed = yaml.load(raw) as OpenApiDocument;
  // Bundles keep internal `#/components/...` refs. The form generator and
  // example extractor expect concrete schemas, so resolve them once here.
  const doc = dereference(parsed);
  docCache.set(apiId, doc);
  return doc;
}

export function extractOAuth2(doc: OpenApiDocument): OAuth2Scheme | null {
  const schemes = doc.components?.securitySchemes;
  if (!schemes) return null;
  for (const scheme of Object.values(schemes)) {
    if (scheme.type === "oauth2") return scheme as OAuth2Scheme;
  }
  return null;
}

export async function listApiSummaries(): Promise<ApiSummary[]> {
  const ids = await listApis();
  const summaries: ApiSummary[] = [];
  for (const id of ids) {
    const doc = await loadSpec(id);
    if (!doc) continue;
    const oauth = extractOAuth2(doc);
    summaries.push({
      id,
      title: doc.info.title,
      description: doc.info.description,
      version: doc.info.version,
      serverUrl: doc.servers?.[0]?.url,
      scopes: oauth?.flows.clientCredentials?.scopes ?? {},
      tokenUrl: oauth?.flows.clientCredentials?.tokenUrl,
    });
  }
  return summaries;
}

export interface EndpointEntry {
  apiId: string;
  method: HttpMethodLower;
  path: string;
  operationId: string;
  summary?: string;
  tag: string;
  scopes: string[];
  operation: OpenApiOperation;
  pathItem: PathItem;
}

// Walk paths and produce one entry per (method, path). Falls back to a
// synthesised operationId when the spec omits one — Spectral usually
// enforces operationId presence so this should rarely fire.
export function listEndpoints(doc: OpenApiDocument, apiId: string): EndpointEntry[] {
  const out: EndpointEntry[] = [];
  for (const [pathKey, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const operationId =
        op.operationId ?? synthesizeOperationId(method, pathKey);
      const scopes = (op.security ?? []).flatMap((entry) =>
        Object.values(entry).flat(),
      );
      out.push({
        apiId,
        method,
        path: pathKey,
        operationId,
        summary: op.summary,
        tag: op.tags?.[0] ?? "default",
        scopes,
        operation: op,
        pathItem: item,
      });
    }
  }
  return out;
}

export function findEndpoint(
  doc: OpenApiDocument,
  apiId: string,
  operationId: string,
): EndpointEntry | null {
  return (
    listEndpoints(doc, apiId).find((e) => e.operationId === operationId) ?? null
  );
}

function synthesizeOperationId(method: string, pathKey: string): string {
  const slug = pathKey
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${method}_${slug}`;
}

import fs from "node:fs/promises";
import path from "node:path";
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

// Server-side OpenAPI spec loader. Reads YAML bundles copied into
// public/specs/<api>.yaml by scripts/copy-specs.mjs and caches them in
// module-level memory (the Next.js dev server reloads on file change).

const SPECS_DIR = path.join(process.cwd(), "public", "specs");

const docCache = new Map<string, OpenApiDocument>();
let listCache: string[] | null = null;

export function resetSpecCache(): void {
  docCache.clear();
  listCache = null;
}

export async function listApis(): Promise<string[]> {
  if (listCache) return listCache;
  try {
    const entries = await fs.readdir(SPECS_DIR);
    listCache = entries
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => f.replace(/\.ya?ml$/, ""))
      .sort();
  } catch {
    listCache = [];
  }
  return listCache;
}

export async function loadSpec(apiId: string): Promise<OpenApiDocument | null> {
  const cached = docCache.get(apiId);
  if (cached) return cached;
  const filePath = path.join(SPECS_DIR, `${apiId}.yaml`);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
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

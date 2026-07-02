// Bruno collection format (opencollection 1.0.0) — serialize/parse helpers.
//
// Neutral module (no Next / node:fs) so it can run on both the server (spec →
// collection export route) and the browser (current-request export, zip
// import). Serialization goes through js-yaml with a fixed style so the output
// mirrors the reference collections in ../openapi/bruno.

import yaml from "js-yaml";

export interface BrunoParam {
  name: string;
  value: string;
  type: "query" | "path";
  description?: string;
}

export interface BrunoHeader {
  name: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

export interface BrunoBody {
  type: "json" | "text";
  /** Raw payload. For JSON this is the pretty-printed string. */
  data: string;
}

// The live request, stripped of the response `examples` Bruno also stores —
// PackRest only round-trips the request itself.
export interface BrunoRequest {
  name: string;
  seq?: number;
  tags?: string[];
  method: string;
  url: string;
  params?: BrunoParam[];
  headers?: BrunoHeader[];
  body?: BrunoBody;
  docs?: string;
}

export interface BrunoOAuth2 {
  type: "oauth2";
  flow: "client_credentials";
  accessTokenUrl: string;
  refreshTokenUrl: string;
  credentials: {
    clientId: string;
    clientSecret: string;
    placement: "basic_auth_header";
  };
  scope: string;
  tokenConfig: {
    id: "token";
    placement: { header: "Bearer" };
    source: "access_token";
  };
  settings: { autoFetchToken: boolean; autoRefreshToken: boolean };
}

export interface BrunoCollectionMeta {
  name: string;
  headers?: BrunoHeader[];
  auth?: BrunoOAuth2;
}

export interface BrunoEnvironment {
  name: string;
  variables: { name: string; value: string }[];
}

// sessionStorage hand-off used when the /collections importer opens a request
// in the builder. Structurally compatible with SavedHeader so the builder can
// feed `headers` straight into its live header editor state.
export const IMPORT_SEED_KEY = "packrest.seed";
export interface ImportSeed {
  apiId: string;
  operationId: string;
  params?: Record<string, string>;
  headers?: { key: string; value: string; enabled?: boolean }[];
  body?: unknown;
}

// Default per-request execution block, verbatim from the reference files.
const DEFAULT_REQUEST_SETTINGS = {
  encodeUrl: true,
  timeout: 0,
  followRedirects: true,
  maxRedirects: 5,
};

// Single-quote scalars (matches the reference output for `{{...}}` templates)
// and never wrap long lines / block scalars.
const DUMP_OPTS: yaml.DumpOptions = {
  lineWidth: -1,
  quotingType: "'",
  forceQuotes: false,
  noRefs: true,
};

// Build the standard OAuth2 client-credentials auth block. `scope` is the
// space-separated scope string Bruno expects.
export function brunoOAuth2(scope: string): BrunoOAuth2 {
  return {
    type: "oauth2",
    flow: "client_credentials",
    accessTokenUrl: "{{oauth_token_url}}",
    refreshTokenUrl: "{{oauth_refresh_url}}",
    credentials: {
      clientId: "{{oauth_client_id}}",
      clientSecret: "{{oauth_client_secret}}",
      placement: "basic_auth_header",
    },
    scope,
    tokenConfig: {
      id: "token",
      placement: { header: "Bearer" },
      source: "access_token",
    },
    settings: { autoFetchToken: true, autoRefreshToken: true },
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeRequestYml(req: BrunoRequest): string {
  const info: Record<string, unknown> = { name: req.name, type: "http" };
  if (req.seq != null) info.seq = req.seq;
  if (req.tags?.length) info.tags = req.tags;

  const http: Record<string, unknown> = {
    method: req.method.toUpperCase(),
    url: req.url,
  };
  if (req.params?.length) {
    http.params = req.params.map((p) => ({
      name: p.name,
      value: p.value,
      type: p.type,
      ...(p.description ? { description: p.description } : {}),
    }));
  }
  if (req.headers?.length) {
    http.headers = req.headers.map((h) => ({
      name: h.name,
      value: h.value,
      ...(h.description ? { description: h.description } : {}),
      ...(h.disabled ? { disabled: true } : {}),
    }));
  }
  if (req.body) http.body = { type: req.body.type, data: req.body.data };
  http.auth = "inherit";

  const doc: Record<string, unknown> = {
    info,
    http,
    settings: DEFAULT_REQUEST_SETTINGS,
  };
  if (req.docs) doc.docs = req.docs;
  return yaml.dump(doc, DUMP_OPTS);
}

export function serializeOpenCollectionYml(meta: BrunoCollectionMeta): string {
  const request: Record<string, unknown> = {};
  if (meta.headers?.length) {
    request.headers = meta.headers.map((h) => ({
      name: h.name,
      value: h.value,
    }));
  }
  if (meta.auth) request.auth = meta.auth;

  const doc: Record<string, unknown> = {
    opencollection: "1.0.0",
    info: { name: meta.name },
    ...(Object.keys(request).length ? { request } : {}),
    bundled: false,
    extensions: { bruno: { ignore: ["node_modules", ".git"] } },
  };
  return yaml.dump(doc, DUMP_OPTS);
}

export function serializeFolderYml(folder: {
  name: string;
  seq?: number;
}): string {
  const info: Record<string, unknown> = { name: folder.name, type: "folder" };
  if (folder.seq != null) info.seq = folder.seq;
  return yaml.dump({ info, request: { auth: "inherit" } }, DUMP_OPTS);
}

export function serializeEnvironmentYml(env: BrunoEnvironment): string {
  return yaml.dump({ name: env.name, variables: env.variables }, DUMP_OPTS);
}

export function serializeWorkspaceYml(
  name: string,
  collections: { name: string; path: string }[],
): string {
  return yaml.dump(
    {
      opencollection: "1.0.0",
      info: { name, type: "workspace" },
      collections,
    },
    DUMP_OPTS,
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function asString(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

// Parse a request `.yml`. Tolerant of missing optional blocks; `examples`,
// `vars`, `script`, `assert` are ignored (only the live request is kept).
export function parseRequestYml(text: string): BrunoRequest {
  const doc = (yaml.load(text) ?? {}) as Record<string, unknown>;
  const info = (doc.info ?? {}) as Record<string, unknown>;
  const http = (doc.http ?? {}) as Record<string, unknown>;

  const rawParams = Array.isArray(http.params) ? http.params : [];
  const params: BrunoParam[] = rawParams.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return {
      name: asString(o.name),
      value: asString(o.value),
      type: o.type === "path" ? "path" : "query",
      description: o.description ? asString(o.description) : undefined,
    };
  });

  const rawHeaders = Array.isArray(http.headers) ? http.headers : [];
  const headers: BrunoHeader[] = rawHeaders.map((h) => {
    const o = (h ?? {}) as Record<string, unknown>;
    return {
      name: asString(o.name),
      value: asString(o.value),
      description: o.description ? asString(o.description) : undefined,
      disabled: o.disabled === true,
    };
  });

  let body: BrunoBody | undefined;
  const rawBody = http.body as Record<string, unknown> | undefined;
  if (rawBody && rawBody.data != null) {
    const type = rawBody.type === "json" ? "json" : "text";
    const data =
      typeof rawBody.data === "string"
        ? rawBody.data
        : JSON.stringify(rawBody.data, null, 2);
    body = { type, data };
  }

  return {
    name: info.name ? asString(info.name) : "request",
    seq: typeof info.seq === "number" ? info.seq : undefined,
    tags: Array.isArray(info.tags) ? info.tags.map(asString) : undefined,
    method: asString(http.method || "GET").toUpperCase(),
    url: asString(http.url),
    params: params.length ? params : undefined,
    headers: headers.length ? headers : undefined,
    body,
    docs: typeof doc.docs === "string" ? doc.docs : undefined,
  };
}

export function parseEnvironmentYml(text: string): BrunoEnvironment {
  const doc = (yaml.load(text) ?? {}) as Record<string, unknown>;
  const rawVars = Array.isArray(doc.variables) ? doc.variables : [];
  return {
    name: asString(doc.name),
    variables: rawVars.map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      return { name: asString(o.name), value: asString(o.value) };
    }),
  };
}

// ---------------------------------------------------------------------------
// URL / path helpers (used to match imported requests back to spec endpoints)
// ---------------------------------------------------------------------------

// Extract the path portion of a Bruno request URL, dropping any leading
// `{{var}}` template (or scheme+host) and the query string.
// "{{baseUrl}}/contracts/:id?page=1" → "/contracts/:id"
export function brunoUrlToPath(url: string): string {
  let rest = url.trim();
  const queryAt = rest.indexOf("?");
  if (queryAt !== -1) rest = rest.slice(0, queryAt);
  // Strip a leading {{...}} template variable.
  rest = rest.replace(/^\{\{[^}]*\}\}/, "");
  // Strip a leading scheme://host if the URL was absolute.
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  if (!rest.startsWith("/")) rest = `/${rest}`;
  return rest;
}

// Convert a Bruno `:param` path to the OpenAPI `{param}` form for matching.
// "/contracts/:contract_id" → "/contracts/{contract_id}"
export function bruPathToOpenApi(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

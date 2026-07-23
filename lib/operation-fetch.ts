// "Run an operation and read its response" helper for auxiliary calls made
// outside the full RequestBuilder form flow — e.g. populating an inline picker
// with a product's funds (GET), or the Parcours document form creating then
// attaching a document (POST multipart + POST JSON).
//
// The tricky part is auth: the app keeps a single shared bearer, and in the
// Parcours each step fetches its own token scoped for *that* step's API. So the
// bearer token in the store belongs to the active step (e.g. `contract`)
// and would be rejected by another API (`product` needs `products:read`). We
// therefore mint a dedicated token for the target operation's own scopes with
// `persist: false`, so the active step's bearer is left untouched. If no
// credentials are configured (or the token call fails), we fall back to the
// shared token — better a 401 the caller can detect than a crash.
//
// Returns the raw ProxyResponse (or null when the spec/op can't be resolved) so
// callers can tell 401/failure from an empty list.

import { loadSpec, findEndpoint, extractOAuth2 } from "@/lib/specs";
import { resolveBaseUrl, resolveTokenUrl, isPreset } from "@/lib/env";
import {
  loadSettings,
  customEnvById,
  credentialsFor,
  isCustomEnvActive,
} from "@/lib/storage";
import { fetchToken, currentToken } from "@/lib/token";
import {
  executeRequest,
  type ProxyResponse,
  type MultipartPayload,
} from "@/lib/http";

// Short-lived cache of non-persisted tokens minted for auxiliary lookups, keyed
// by (tokenUrl, clientId, scopes). Two fieldOptions sources on one step (e.g. a
// product's funds + preset allocations) hit the same API with the same scopes;
// without this each fetchOperationJson call would mint a redundant token.
const auxTokenCache = new Map<
  string,
  { accessToken: string; expiresAt: number }
>();

// Resolve an operation's URL and mint a bearer scoped for its API without
// clobbering the shared store. Returns null when the spec/op can't be resolved.
async function resolveAndAuth(
  apiId: string,
  operationId: string,
  pathParams: Record<string, string>,
): Promise<{
  url: string;
  headers: Record<string, string>;
  method: string;
} | null> {
  const doc = await loadSpec(apiId);
  if (!doc) return null;
  const entry = findEndpoint(doc, apiId, operationId);
  if (!entry) return null;

  const s = loadSettings();
  const baseUrl = resolveBaseUrl(
    apiId,
    s.environment,
    customEnvById(s, s.environment)?.baseUrl ?? "",
    doc.servers?.[0]?.url ?? "",
    s.apiPaths,
  );
  const pathKeys = new Set<string>();
  const filledPath = entry.path.replace(/\{([^}]+)\}/g, (_, k) => {
    pathKeys.add(k);
    return encodeURIComponent(pathParams[k] ?? "");
  });
  // Params not consumed by a path placeholder are appended as a query string,
  // so a list operation that filters via query (not a path template) is still
  // filtered rather than returning an unfiltered list.
  const query = Object.entries(pathParams)
    .filter(([k, v]) => v !== "" && !pathKeys.has(k))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  // Mint a token scoped for THIS operation's API without clobbering the store,
  // reusing a cached one for the same (tokenUrl, client, scopes) within its life.
  let accessToken = currentToken()?.accessToken ?? null;
  const creds = credentialsFor(s);
  const oauth = extractOAuth2(doc);
  if (creds.clientId && creds.clientSecret) {
    const resolvedTokenUrl = resolveTokenUrl(
      s.environment,
      customEnvById(s, s.environment)?.tokenUrl ?? "",
      oauth?.flows.clientCredentials?.tokenUrl ?? "",
    );
    const cacheKey = `${resolvedTokenUrl}|${creds.clientId}|${[...entry.scopes]
      .sort()
      .join(" ")}`;
    const cached = auxTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 10000) {
      accessToken = cached.accessToken;
    } else {
      try {
        const token = await fetchToken({
          tokenUrl: resolvedTokenUrl,
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          scopes: entry.scopes,
          custom: !isPreset(s.environment),
          persist: false,
        });
        accessToken = token.accessToken;
        auxTokenCache.set(cacheKey, {
          accessToken: token.accessToken,
          expiresAt: token.expiresAt,
        });
      } catch {
        /* keep the shared token as a fallback */
      }
    }
  }

  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  return {
    url: `${baseUrl}${filledPath}${query ? `?${query}` : ""}`,
    headers,
    method: entry.method.toUpperCase(),
  };
}

// Run any operation with a per-API scoped token. GET carries no body; a POST/PUT
// may pass a JSON `body` or a `multipart` payload (mutually exclusive). Returns
// null only when the spec/op can't be resolved.
export async function callOperation(opts: {
  apiId: string;
  operationId: string;
  pathParams?: Record<string, string>;
  method?: string;
  body?: object | null;
  multipart?: MultipartPayload;
}): Promise<ProxyResponse | null> {
  const resolved = await resolveAndAuth(
    opts.apiId,
    opts.operationId,
    opts.pathParams ?? {},
  );
  if (!resolved) return null;

  return executeRequest({
    // Default to the spec-declared verb; an explicit opts.method still wins.
    method: opts.method ?? resolved.method,
    url: resolved.url,
    headers: resolved.headers,
    body: opts.body,
    multipart: opts.multipart,
    custom: isCustomEnvActive(),
  });
}

// GET convenience wrapper (used by the Parcours fieldOptions picker fetch).
export async function fetchOperationJson(
  apiId: string,
  operationId: string,
  pathParams: Record<string, string>,
): Promise<ProxyResponse | null> {
  return callOperation({ apiId, operationId, pathParams, method: "GET" });
}

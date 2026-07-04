// Environment presets. The OpenAPI bundles declare generic URLs
// (`api.pack-solutions.com`) but real-world usage is on Gravitee gateways
// where each API is served under its own path. We surface dev and rec as
// named presets so the user doesn't have to remember the exact host.

export type EnvName = "dev" | "rec" | "custom";
export type EnvPresetName = Exclude<EnvName, "custom">;

export interface EnvPreset {
  id: EnvPresetName;
  label: string;
  description: string;
  // Gateway origin without any path (e.g. https://dev…gravitee.cloud).
  host: string;
  // Returns the base URL for a given API id (folder name under dist/).
  baseUrlFor(apiId: string): string;
  tokenUrl: string;
}

const DEV_HOST = "https://dev.apim.gateway.pack-solutions.gravitee.cloud";
const REC_HOST = "https://rec.apim.gateway.pack-solutions.gravitee.cloud";

// Default gateway context path per API — the segment appended after the host,
// before the OpenAPI path. The request URL is `baseUrl + <openapi path>`, and
// most bundles already carry their resource segment (contract.yaml paths start
// with /contracts, etc.), so those APIs sit at the gateway root (""). Only
// person, webhook and payment-method add a prefix their bundles omit
// (payment-method is deployed under the person context path, per the upstream
// Bruno collection). An API absent from this map is served at the gateway
// root — the code never invents a segment; only this map and the per-API
// override in Settings ("context paths des APIs") decide.
const DEFAULT_CONTEXT_PATHS: Record<string, string> = {
  contract: "",
  "service-request": "",
  document: "",
  "order-book": "",
  product: "",
  person: "person",
  "payment-method": "person",
  webhook: "webhooks",
};

// The gateway context-path segment for an API in the absence of a user
// override. Unlisted APIs are served at the gateway root ("").
export function defaultContextPathFor(apiId: string): string {
  return DEFAULT_CONTEXT_PATHS[apiId] ?? "";
}

// Join a gateway host with a context path, avoiding a trailing/double slash
// when the context path is empty (API served at the root).
function joinHost(host: string, contextPath: string): string {
  return contextPath ? `${host}/${contextPath}` : host;
}

export const ENV_PRESETS: Record<EnvPresetName, EnvPreset> = {
  dev: {
    id: "dev",
    label: "Dev (Gravitee)",
    description:
      "Gateway de développement. Chaque API a son propre context path.",
    host: DEV_HOST,
    baseUrlFor: (apiId) => joinHost(DEV_HOST, defaultContextPathFor(apiId)),
    tokenUrl:
      "https://dev.am.gateway.pack-solutions.gravitee.cloud/pack-solutions/oauth/token",
  },
  rec: {
    id: "rec",
    label: "Recette (Gravitee)",
    description:
      "Gateway de recette. Mêmes paths que dev mais sur l'environnement rec.",
    host: REC_HOST,
    baseUrlFor: (apiId) => joinHost(REC_HOST, defaultContextPathFor(apiId)),
    tokenUrl:
      "https://rec.am.gateway.pack-solutions.gravitee.cloud/pack-solutions/oauth/token",
  },
};

export const ENV_OPTIONS: EnvName[] = ["dev", "rec", "custom"];

// Strip leading/trailing slashes so a user-typed "/document-api/" normalises
// to "document-api".
function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

// The path segment used for an API under the gateway presets: the per-API
// override when set, else the default context path (which may be "" for APIs
// served at the gateway root).
export function contextPathFor(
  apiId: string,
  apiPaths?: Record<string, string>,
): string {
  const override = apiPaths?.[apiId];
  const trimmed = override ? trimSlashes(override) : "";
  return trimmed || defaultContextPathFor(apiId);
}

// Resolve the effective base URL for an API given the user's settings.
// Custom env returns the user-provided baseUrl as-is — when empty the
// caller falls back to the spec default. Presets append the per-API context
// path to the gateway host.
export function resolveBaseUrl(
  apiId: string,
  env: EnvName,
  customBaseUrl: string,
  specDefault: string,
  apiPaths?: Record<string, string>,
): string {
  if (env === "custom") return customBaseUrl || specDefault;
  return joinHost(ENV_PRESETS[env].host, contextPathFor(apiId, apiPaths));
}

// Inverse of resolveBaseUrl for presets: derive the context-path segment from
// a full base URL the user edited in the builder. Returns null for custom env
// or when the URL no longer points at the preset host (host was changed).
export function contextPathFromBaseUrl(
  env: EnvName,
  baseUrl: string,
): string | null {
  if (env === "custom") return null;
  const host = ENV_PRESETS[env].host;
  // Edited back to exactly the host → the API is served at the gateway root.
  if (baseUrl === host || baseUrl === `${host}/`) return "";
  const prefix = `${host}/`;
  if (!baseUrl.startsWith(prefix)) return null;
  return trimSlashes(baseUrl.slice(prefix.length));
}

export function resolveTokenUrl(
  env: EnvName,
  customTokenUrl: string,
  specDefault: string,
): string {
  if (env === "custom") return customTokenUrl || specDefault;
  return ENV_PRESETS[env].tokenUrl;
}

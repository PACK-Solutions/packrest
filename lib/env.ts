// Environment presets. The OpenAPI bundles declare generic URLs
// (`api.pack-solutions.com`) but real-world usage is on Gravitee gateways
// where each API is served under its own path. We surface dev and rec as
// named presets so the user doesn't have to remember the exact host.

// An environment identifier: either a built-in preset name ("dev" | "rec") or
// a user-defined custom environment's id. Custom envs are named, plural, and
// managed in Settings (see CustomEnv in lib/storage.ts).
export type EnvId = string;
export type EnvPresetName = "dev" | "rec";

// True when the id names a built-in preset (as opposed to a custom env id).
export function isPreset(id: string): id is EnvPresetName {
  return id === "dev" || id === "rec";
}

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

// No API gets a default gateway context path. Every API is served at the
// gateway root ("") until the user sets a per-API context path explicitly in
// Settings ("context paths des APIs"). The code never invents a segment; only
// the per-API override decides.
export function defaultContextPathFor(_apiId: string): string {
  return "";
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

export const PRESET_IDS: EnvPresetName[] = ["dev", "rec"];

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
  env: EnvId,
  customBaseUrl: string,
  specDefault: string,
  apiPaths?: Record<string, string>,
): string {
  if (!isPreset(env)) return customBaseUrl || specDefault;
  return joinHost(ENV_PRESETS[env].host, contextPathFor(apiId, apiPaths));
}

// Inverse of resolveBaseUrl for presets: derive the context-path segment from
// a full base URL the user edited in the builder. Returns null for custom env
// or when the URL no longer points at the preset host (host was changed).
export function contextPathFromBaseUrl(
  env: EnvId,
  baseUrl: string,
): string | null {
  if (!isPreset(env)) return null;
  const host = ENV_PRESETS[env].host;
  // Edited back to exactly the host → the API is served at the gateway root.
  if (baseUrl === host || baseUrl === `${host}/`) return "";
  const prefix = `${host}/`;
  if (!baseUrl.startsWith(prefix)) return null;
  return trimSlashes(baseUrl.slice(prefix.length));
}

export function resolveTokenUrl(
  env: EnvId,
  customTokenUrl: string,
  specDefault: string,
): string {
  if (!isPreset(env)) return customTokenUrl || specDefault;
  return ENV_PRESETS[env].tokenUrl;
}

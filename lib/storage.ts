// Persistence for PackRest. Backed by tauri-plugin-store when running inside
// the Tauri webview, and by localStorage as a fallback (plain-browser
// `next dev` / prerender). Either way the public API stays *synchronous* —
// an in-memory cache is hydrated once at startup by `bootstrapStorage()`
// (awaited by the Tauri provider before any page renders), so the ~dozen
// call sites keep reading settings/token inline without awaiting.

import { storeGet, storeSet, storeDelete } from "./store";
import type { EnvName } from "./env";

export interface SavedHeader {
  key: string;
  value: string;
  enabled?: boolean;
}

// OAuth2 client credentials. Kept per environment (see Settings.credentials):
// dev / rec / custom each have their own pair.
export interface Credentials {
  clientId: string;
  clientSecret: string;
}

export interface Settings {
  // dev | rec use built-in Gravitee URL presets; custom honours baseUrl / tokenUrl.
  environment: EnvName;
  baseUrl: string;
  tokenUrl: string;
  // Client credentials per environment — switching env swaps which pair the
  // token request uses. Migrated from the former single global pair.
  credentials: Record<EnvName, Credentials>;
  // Per-API context path overrides (apiId → path segment, e.g. "document-api").
  // Default path is the apiId itself. Applies to the dev/rec gateway presets;
  // the host stays the preset's, only the path segment is swapped.
  apiPaths?: Record<string, string>;
}

// A fresh, empty credential pair for every environment.
export function emptyCredentials(): Record<EnvName, Credentials> {
  return {
    dev: { clientId: "", clientSecret: "" },
    rec: { clientId: "", clientSecret: "" },
    custom: { clientId: "", clientSecret: "" },
  };
}

// The credential pair for an environment (the active one by default). Settings
// are always normalized (bootstrapStorage → normalizeSettings), so every env
// key is present.
export function credentialsFor(
  settings: Settings,
  env: EnvName = settings.environment,
): Credentials {
  return settings.credentials[env];
}

export interface TokenState {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  scope?: string;
}

const KEYS = {
  settings: "packrest.settings",
  token: "packrest.token",
} as const;

const DEFAULT_SETTINGS: Settings = {
  environment: "dev",
  baseUrl: "",
  tokenUrl: "",
  credentials: emptyCredentials(),
  apiPaths: {},
};

// The persisted shape, tolerant of older data: pre-per-env settings stored a
// single global clientId/clientSecret and no `credentials` map.
type StoredSettings = Partial<Omit<Settings, "credentials">> & {
  credentials?: Partial<Record<EnvName, Partial<Credentials>>>;
  clientId?: string;
  clientSecret?: string;
};

// Build a complete Settings from whatever was stored, filling defaults and
// migrating the legacy global credentials onto the environment that was active
// when they were saved.
function normalizeSettings(raw: StoredSettings | undefined | null): Settings {
  const r = raw ?? {};
  const environment: EnvName = r.environment ?? DEFAULT_SETTINGS.environment;
  const credentials = emptyCredentials();
  if (r.credentials) {
    for (const env of Object.keys(credentials) as EnvName[]) {
      const c = r.credentials[env];
      if (c)
        credentials[env] = {
          clientId: c.clientId ?? "",
          clientSecret: c.clientSecret ?? "",
        };
    }
  } else if (r.clientId || r.clientSecret) {
    credentials[environment] = {
      clientId: r.clientId ?? "",
      clientSecret: r.clientSecret ?? "",
    };
  }
  return {
    environment,
    baseUrl: r.baseUrl ?? "",
    tokenUrl: r.tokenUrl ?? "",
    credentials,
    apiPaths: { ...(r.apiPaths ?? {}) },
  };
}

// Fired on the window after settings are written, so components mounted in the
// same tab (the request builder, the settings page) can re-sync immediately.
export const SETTINGS_CHANGED_EVENT = "packrest:settings-changed";

// --- in-memory cache (source of truth after hydration) ---------------------

let settingsCache: Settings = { ...DEFAULT_SETTINGS };
let tokenCache: TokenState | null = null;
let hydrated = false;

// --- hydration -------------------------------------------------------------

// Populate the in-memory cache from the persistent backend. Idempotent, and
// awaited by the Tauri provider before the app renders so synchronous readers
// never see stale defaults.
export async function bootstrapStorage(): Promise<void> {
  if (hydrated) return;
  try {
    const s = await storeGet<StoredSettings>(KEYS.settings);
    settingsCache = normalizeSettings(s);
    tokenCache = (await storeGet<TokenState>(KEYS.token)) ?? null;
  } catch {
    // keep defaults on any read/parse failure
  }
  hydrated = true;
}

// --- persistence (fire-and-forget; cache already updated) ------------------

function persistSettings(): void {
  storeSet(KEYS.settings, settingsCache).catch(() => {});
}

function persistToken(): void {
  (tokenCache === null
    ? storeDelete(KEYS.token)
    : storeSet(KEYS.token, tokenCache)
  ).catch(() => {});
}

// --- public API (synchronous) ----------------------------------------------

export function loadSettings(): Settings {
  return { ...settingsCache };
}
export function saveSettings(s: Settings): void {
  settingsCache = { ...s };
  persistSettings();
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

export function loadToken(): TokenState | null {
  if (!tokenCache) return null;
  if (tokenCache.expiresAt <= Date.now()) return null;
  return tokenCache;
}
export function saveToken(t: TokenState | null): void {
  tokenCache = t;
  persistToken();
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

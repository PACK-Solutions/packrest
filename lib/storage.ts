// Persistence for PackRest. Backed by tauri-plugin-store when running inside
// the Tauri webview, and by localStorage as a fallback (plain-browser
// `next dev` / prerender). Either way the public API stays *synchronous* —
// an in-memory cache is hydrated once at startup by `bootstrapStorage()`
// (awaited by the Tauri provider before any page renders), so the ~dozen
// call sites keep reading settings/token inline without awaiting.

import { storeGet, storeSet, storeDelete } from "./store";

export interface SavedHeader {
  key: string;
  value: string;
  enabled?: boolean;
}

export interface Settings {
  // dev | rec use built-in Gravitee URL presets; custom honours baseUrl / tokenUrl.
  environment: "dev" | "rec" | "custom";
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  // Per-API context path overrides (apiId → path segment, e.g. "document-api").
  // Default path is the apiId itself. Applies to the dev/rec gateway presets;
  // the host stays the preset's, only the path segment is swapped.
  apiPaths?: Record<string, string>;
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
  clientId: "",
  clientSecret: "",
  apiPaths: {},
};

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
    const s = await storeGet<Partial<Settings>>(KEYS.settings);
    settingsCache = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
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

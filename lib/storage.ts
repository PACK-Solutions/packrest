// localStorage-backed persistence for PackRest. All getters tolerate
// SSR (no window) and return the default value when called server-side.

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

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota errors are not surfaced — PackRest still works without persistence
  }
}

const DEFAULT_SETTINGS: Settings = {
  environment: "dev",
  baseUrl: "",
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  apiPaths: {},
};

// Fired on the window after settings are written, so components mounted in the
// same tab (the request builder, the settings page) can re-sync immediately —
// the native `storage` event only fires in *other* tabs.
export const SETTINGS_CHANGED_EVENT = "packrest:settings-changed";

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...safeRead<Partial<Settings>>(KEYS.settings, {}) };
}
export function saveSettings(s: Settings): void {
  safeWrite(KEYS.settings, s);
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

export function loadToken(): TokenState | null {
  const t = safeRead<TokenState | null>(KEYS.token, null);
  if (!t) return null;
  if (t.expiresAt <= Date.now()) return null;
  return t;
}
export function saveToken(t: TokenState | null): void {
  if (t === null) {
    if (typeof window !== "undefined") window.localStorage.removeItem(KEYS.token);
    return;
  }
  safeWrite(KEYS.token, t);
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

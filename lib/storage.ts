// Persistence for PackRest. Backed by tauri-plugin-store when running inside
// the Tauri webview, and by localStorage as a fallback (plain-browser
// `next dev` / prerender). Either way the public API stays *synchronous* —
// an in-memory cache is hydrated once at startup by `bootstrapStorage()`
// (awaited by the Tauri provider before any page renders), so the ~dozen
// call sites keep reading settings/token inline without awaiting.

import { storeGet, storeSet, storeDelete } from "./store";
import { isPreset } from "./env";
import type { EnvId, EnvPresetName } from "./env";
import { defaultEnvColor } from "./design";

export interface SavedHeader {
  key: string;
  value: string;
  enabled?: boolean;
}

// OAuth2 client credentials. Presets (dev/rec) keep a pair each in
// Settings.credentials; each custom env carries its own pair inline (CustomEnv).
export interface Credentials {
  clientId: string;
  clientSecret: string;
}

// A user-defined environment: named, editable, and self-contained (its own
// URLs + OAuth pair). Managed in Settings; several may coexist. `id` is stable
// (from newId("env")) so renaming never breaks the active-env pointer.
export interface CustomEnv {
  id: string;
  name: string;
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  // Badge color (hex) shown in the topbar switcher and env picker.
  color: string;
}

export interface Settings {
  // A preset name ("dev"/"rec", built-in Gravitee URLs) or a custom env id.
  environment: EnvId;
  // Client credentials for the presets — switching env swaps which pair the
  // token request uses. Custom envs keep their own pair inside customEnvs.
  credentials: Record<EnvPresetName, Credentials>;
  // User-defined environments (named URLs + creds). Empty by default.
  customEnvs: CustomEnv[];
  // Per-API context path overrides (apiId → path segment, e.g. "document-api").
  // Default path is the apiId itself. Applies to the dev/rec gateway presets;
  // the host stays the preset's, only the path segment is swapped.
  apiPaths?: Record<string, string>;
}

// A fresh, empty credential pair for each preset.
export function emptyCredentials(): Record<EnvPresetName, Credentials> {
  return {
    dev: { clientId: "", clientSecret: "" },
    rec: { clientId: "", clientSecret: "" },
  };
}

// The credential pair for an environment (the active one by default): a
// preset's stored pair, or the matching custom env's inline pair. Settings are
// always normalized, so preset keys are present; an unknown id yields an empty
// pair.
export function credentialsFor(
  settings: Settings,
  env: EnvId = settings.environment,
): Credentials {
  if (isPreset(env)) return settings.credentials[env];
  const custom = customEnvById(settings, env);
  return custom
    ? { clientId: custom.clientId, clientSecret: custom.clientSecret }
    : { clientId: "", clientSecret: "" };
}

// Find a custom environment by id (undefined for preset ids / unknown ids).
export function customEnvById(
  settings: Settings,
  id: string,
): CustomEnv | undefined {
  return settings.customEnvs.find((e) => e.id === id);
}

// True when the active environment is a user-defined custom one (not a preset).
// The token/proxy paths use this to relax the URL policy (allow http + a local
// dev server) only for custom envs.
export function isCustomEnvActive(): boolean {
  return !isPreset(loadSettings().environment);
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
  credentials: emptyCredentials(),
  customEnvs: [],
  apiPaths: {},
};

// The persisted shape, tolerant of older data: pre-per-env settings stored a
// single global clientId/clientSecret; the previous single-custom layout stored
// baseUrl/tokenUrl scalars and a `credentials.custom` pair.
type StoredSettings = Partial<Omit<Settings, "credentials" | "customEnvs">> & {
  credentials?: Partial<Record<string, Partial<Credentials>>>;
  customEnvs?: Partial<CustomEnv>[];
  // legacy single-custom env scalars
  baseUrl?: string;
  tokenUrl?: string;
  // legacy pre-per-env global pair
  clientId?: string;
  clientSecret?: string;
};

// Build a complete Settings from whatever was stored, filling defaults and
// migrating legacy layouts: the pre-per-env global pair, and the former single
// unnamed custom env (baseUrl/tokenUrl + credentials.custom) → one CustomEnv.
function normalizeSettings(raw: StoredSettings | undefined | null): Settings {
  const r = raw ?? {};
  const credentials = emptyCredentials();
  if (r.credentials) {
    for (const env of Object.keys(credentials) as EnvPresetName[]) {
      const c = r.credentials[env];
      if (c)
        credentials[env] = {
          clientId: c.clientId ?? "",
          clientSecret: c.clientSecret ?? "",
        };
    }
  } else if ((r.clientId || r.clientSecret) && r.environment && isPreset(r.environment)) {
    // Legacy single global pair, attached to the preset that was then active.
    credentials[r.environment] = {
      clientId: r.clientId ?? "",
      clientSecret: r.clientSecret ?? "",
    };
  }

  // Custom environments: adopt the new array when present, else migrate the
  // former single-custom slot into one env keyed "custom" so an existing
  // `environment: "custom"` pointer still resolves.
  let customEnvs: CustomEnv[];
  if (Array.isArray(r.customEnvs)) {
    customEnvs = r.customEnvs.map((e, i) => ({
      id: e?.id || `env_${i}`,
      name: e?.name ?? "Personnalisé",
      baseUrl: e?.baseUrl ?? "",
      tokenUrl: e?.tokenUrl ?? "",
      clientId: e?.clientId ?? "",
      clientSecret: e?.clientSecret ?? "",
      color: e?.color || defaultEnvColor(i),
    }));
  } else {
    const legacyCustom = r.credentials?.custom;
    const hasLegacy =
      r.environment === "custom" ||
      !!r.baseUrl ||
      !!r.tokenUrl ||
      !!legacyCustom?.clientId ||
      !!legacyCustom?.clientSecret;
    customEnvs = hasLegacy
      ? [
          {
            id: "custom",
            name: "Personnalisé",
            baseUrl: r.baseUrl ?? "",
            tokenUrl: r.tokenUrl ?? "",
            clientId: legacyCustom?.clientId ?? "",
            clientSecret: legacyCustom?.clientSecret ?? "",
            color: defaultEnvColor(0),
          },
        ]
      : [];
  }

  // Keep the active env only if it still resolves to a preset or a known custom
  // env; otherwise fall back to the default.
  const requested = r.environment ?? DEFAULT_SETTINGS.environment;
  const environment: EnvId =
    isPreset(requested) || customEnvs.some((e) => e.id === requested)
      ? requested
      : DEFAULT_SETTINGS.environment;

  return {
    environment,
    credentials,
    customEnvs,
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

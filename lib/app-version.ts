// The running app's version number, surfaced in the sidebar footer and the
// Settings "À propos" card. Inside Tauri it comes from the authoritative
// runtime value (tauri.conf.json) via `getVersion()`; outside Tauri (plain
// `next dev` / prerender) it falls back to the build-time constant injected
// from package.json in next.config.mjs.

import { isTauri } from "./platform";

/** Build-time version from package.json (see `env` in next.config.mjs). */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

// The version never changes while the process runs, so resolve it once and
// share the promise — every consumer mount then settles instantly instead of
// paying a fresh Tauri IPC round-trip.
let cached: Promise<string> | null = null;

export function getAppVersion(): Promise<string> {
  return (cached ??= resolveAppVersion());
}

async function resolveAppVersion(): Promise<string> {
  if (isTauri()) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      /* fall through to the build-time constant */
    }
  }
  return APP_VERSION;
}

// Shared key/value persistence primitive. One tauri-plugin-store handle for
// the whole app (settings, token, specsDir, GitLab config), with a
// localStorage fallback outside Tauri. Async by nature; lib/storage.ts layers
// a synchronous in-memory cache on top for the hot settings/token paths.

import { isTauri } from "./platform";

const STORE_FILE = "packrest.json";

type StoreLike = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
};

let storePromise: Promise<StoreLike> | null = null;
function getStore(): Promise<StoreLike> {
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store").then((m) =>
      m.load(STORE_FILE),
    ) as Promise<StoreLike>;
  }
  return storePromise;
}

export async function storeGet<T>(key: string): Promise<T | undefined> {
  if (isTauri()) {
    const s = await getStore();
    return (await s.get<T>(key)) ?? undefined;
  }
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(key);
  return raw == null ? undefined : (JSON.parse(raw) as T);
}

export async function storeSet(key: string, value: unknown): Promise<void> {
  if (isTauri()) {
    const s = await getStore();
    await s.set(key, value);
    await s.save();
    return;
  }
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export async function storeDelete(key: string): Promise<void> {
  if (isTauri()) {
    const s = await getStore();
    await s.delete(key);
    await s.save();
    return;
  }
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

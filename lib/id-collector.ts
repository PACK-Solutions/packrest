// ID collector — captures the id of freshly-created resources so they can be
// copied and reused across APIs. When a POST returns a 2xx whose JSON body
// carries an `id` field, that id is recorded per API; only the 3 most recent
// per API are kept.
//
// Same shape as lib/storage.ts: an async persistent backend (lib/store.ts)
// fronted by an in-memory cache hydrated once at startup, so the public read
// API is synchronous. Components re-read from the cache on the change event.

import { storeGet, storeSet } from "./store";

export interface CollectedId {
  id: string; // resource id, taken from the response body's `id` field
  apiId: string;
  operationId?: string;
  method: string; // "POST"
  label: string; // operation.summary, else the endpoint path
  createdAt: number; // Date.now()
}

// apiId → most-recent-first list of collected ids.
type Collected = Record<string, CollectedId[]>;

const KEY = "packrest.collected-ids";
const MAX_PER_API = 3;

// Fired on the window after the collection is mutated, so the topbar panel can
// re-sync immediately. Plain Event (no payload) — listeners re-read the cache.
export const COLLECTED_IDS_CHANGED_EVENT = "packrest:collected-ids-changed";

// --- in-memory cache (source of truth after hydration) ---------------------

let cache: Collected = {};
let hydrated = false;

// --- hydration -------------------------------------------------------------

// Populate the in-memory cache from the persistent backend. Idempotent, and
// awaited by the Tauri provider before the app renders.
export async function bootstrapIdCollector(): Promise<void> {
  if (hydrated) return;
  try {
    cache = (await storeGet<Collected>(KEY)) ?? {};
  } catch {
    cache = {};
  }
  hydrated = true;
}

// --- persistence (fire-and-forget; cache already updated) ------------------

function persist(): void {
  storeSet(KEY, cache).catch(() => {});
}

function notify(): void {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(COLLECTED_IDS_CHANGED_EVENT));
}

// --- public API ------------------------------------------------------------

export function loadCollectedIds(): Collected {
  return cache;
}

export function collectedIdsFor(apiId: string): CollectedId[] {
  return cache[apiId] ?? [];
}

export function totalCollectedIds(): number {
  return Object.values(cache).reduce((n, list) => n + list.length, 0);
}

// Record a freshly-created resource. Takes the id from the response body's `id`
// field, prepends it to the API's list, caps to the 3 most recent, persists and
// notifies. An empty id is ignored.
export function recordCreatedId(
  input: Omit<CollectedId, "createdAt">,
): void {
  const id = input.id.trim();
  if (!id) return;
  const entry: CollectedId = { ...input, id, createdAt: Date.now() };
  const existing = cache[input.apiId] ?? [];
  cache = {
    ...cache,
    [input.apiId]: [entry, ...existing].slice(0, MAX_PER_API),
  };
  persist();
  notify();
}

// Clear one API's collected ids, or all of them when no apiId is given.
export function clearCollectedIds(apiId?: string): void {
  if (apiId) {
    if (!cache[apiId]) return;
    const next = { ...cache };
    delete next[apiId];
    cache = next;
  } else {
    cache = {};
  }
  persist();
  notify();
}

// ID collector — captures resource ids so they can be reused across APIs, from
// the topbar panel or the IdPicker beside each id input. Two collections:
//   • created: the `id` of a 2xx POST's JSON body, the 5 most recent per API;
//   • seen: the items of a 2xx GET on a collection endpoint, the 20 most recent
//     per list operation, each with a label read from the item.
//
// Same shape as lib/storage.ts: an async persistent backend (lib/store.ts)
// fronted by an in-memory cache hydrated once at startup, so the public read
// API is synchronous. Components re-read from the cache on the change event.

import { storeGet, storeSet } from "./store";
import type { JsonSchema } from "./types";

export interface CollectedId {
  id: string; // resource id, taken from the response body's `id` field
  apiId: string;
  operationId?: string;
  method: string; // "POST"
  label: string; // operation.summary, else the endpoint path
  name?: string; // readable label of the created resource (see itemLabel)
  origin?: IdOrigin; // absent: the request tester
  createdAt: number; // Date.now()
}

export type IdOrigin = "parcours";

// apiId → most-recent-first list of collected ids.
type Collected = Record<string, CollectedId[]>;

export interface SeenId {
  id: string;
  label?: string;
  apiId: string;
  operationId: string;
  operationLabel: string; // operation.summary, else the endpoint path
  seenAt: number;
}

export interface SeenItem {
  id: string;
  label?: string;
}

// "<apiId>::<operationId>" → most-recent-first list of seen ids.
type Seen = Record<string, SeenId[]>;

const KEY = "packrest.collected-ids";
const SEEN_KEY = "packrest.seen-ids";
const MAX_PER_API = 5;
const MAX_SEEN_PER_OPERATION = 20;

// Fired on the window after the collection is mutated, so the topbar panel can
// re-sync immediately. Plain Event (no payload) — listeners re-read the cache.
export const COLLECTED_IDS_CHANGED_EVENT = "packrest:collected-ids-changed";

// --- in-memory cache (source of truth after hydration) ---------------------

let cache: Collected = {};
let seenCache: Seen = {};
let hydrated = false;

// --- hydration -------------------------------------------------------------

// Populate the in-memory cache from the persistent backend. Idempotent, and
// awaited by the Tauri provider before the app renders.
export async function bootstrapIdCollector(): Promise<void> {
  if (hydrated) return;
  [cache, seenCache] = await Promise.all([
    storeGet<Collected>(KEY).catch(() => undefined).then((v) => v ?? {}),
    storeGet<Seen>(SEEN_KEY).catch(() => undefined).then((v) => v ?? {}),
  ]);
  hydrated = true;
}

// --- persistence (fire-and-forget; cache already updated) ------------------

function persist(): void {
  storeSet(KEY, cache).catch(() => {});
}

function persistSeen(): void {
  storeSet(SEEN_KEY, seenCache).catch(() => {});
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

export function loadSeenIds(): Seen {
  return seenCache;
}

// Record a freshly-created resource. Takes the id from the response body's `id`
// field, prepends it to the API's list, caps to the 5 most recent, persists and
// notifies. An empty id is ignored, and so is one equal to a path param of the
// request: that POST acted on an existing resource (submit, update, cancel…).
// An id already collected moves to the top, keeping the operation that created
// it and its origin; only its name is refreshed.
export function recordCreatedId(
  input: Omit<CollectedId, "createdAt">,
  pathParamValues: string[] = [],
): void {
  const id = input.id.trim();
  if (!id || pathParamValues.some((v) => v.trim() === id)) return;
  const existing = cache[input.apiId] ?? [];
  const previous = existing.find((e) => e.id === id);
  const entry: CollectedId = {
    ...(previous ?? input),
    id,
    name: input.name ?? previous?.name,
    createdAt: Date.now(),
  };
  cache = {
    ...cache,
    [input.apiId]: [entry, ...existing.filter((e) => e.id !== id)].slice(
      0,
      MAX_PER_API,
    ),
  };
  persist();
  notify();
}

// Record the items of a list response, first in the response order, ahead of
// what that operation listed before; deduped by id, capped to 20. `replace`
// drops what it listed before: an unfiltered first page is the whole truth.
export function recordSeenIds(
  source: Pick<SeenId, "apiId" | "operationId" | "operationLabel">,
  items: SeenItem[],
  { replace = false } = {},
): void {
  if (!items.length && !replace) return;
  const key = `${source.apiId}::${source.operationId}`;
  const seenAt = Date.now();
  const merged = [
    ...items.map((item) => ({ ...source, ...item, seenAt })),
    ...(replace ? [] : (seenCache[key] ?? [])),
  ];
  const ids = new Set<string>();
  seenCache = {
    ...seenCache,
    [key]: merged
      .filter((e) => !ids.has(e.id) && ids.add(e.id))
      .slice(0, MAX_SEEN_PER_OPERATION),
  };
  persistSeen();
  notify();
}

// Clear one API's created and seen ids, or every id when no apiId is given.
export function clearCollectedIds(apiId?: string): void {
  if (apiId) {
    const next = { ...cache };
    delete next[apiId];
    cache = next;
    seenCache = Object.fromEntries(
      Object.entries(seenCache).filter(([, list]) => list[0]?.apiId !== apiId),
    );
  } else {
    cache = {};
    seenCache = {};
  }
  persist();
  persistSeen();
  notify();
}

export interface ResponseSource {
  apiId: string;
  operationId: string;
  method: string;
  path: string; // the endpoint template, e.g. /contracts/{contract_id}/submit
  operationLabel: string; // operation.summary, else the path
  pathParamValues: string[];
  origin?: IdOrigin;
}

// Collect what a response offers for reuse: the id of a 2xx POST's JSON body
// (see recordCreatedId), or the items of a 2xx GET on a list endpoint.
export function recordResponseIds(
  src: ResponseSource,
  res: { status: number; body: unknown },
): void {
  if (res.status < 200 || res.status >= 300) return;
  const method = src.method.toUpperCase();
  if (method === "GET" && isCollectionPath(src.path)) {
    recordSeenIds(
      { apiId: src.apiId, operationId: src.operationId, operationLabel: src.operationLabel },
      extractSeenItems(res.body),
    );
    return;
  }
  if (method !== "POST" || !isItem(res.body)) return;
  const id = text(res.body.id);
  if (!id) return;
  recordCreatedId(
    {
      apiId: src.apiId,
      operationId: src.operationId,
      method,
      id,
      label: src.operationLabel,
      name: itemLabel(res.body),
      ...(src.origin ? { origin: src.origin } : {}),
    },
    src.pathParamValues,
  );
}

// A list endpoint ends in a static segment (`/funds`,
// `/individuals/{person_id}/payment-methods`); an item endpoint in a `{param}`.
export function isCollectionPath(path: string): boolean {
  const last = path.split("?")[0].split("/").filter(Boolean).at(-1);
  return !!last && !/^\{.*\}$/.test(last);
}

const LABEL_FIELDS = [
  "name",
  "label",
  "title",
  "commercial_name",
  "contract_number",
  "isin",
  "code",
];

function isItem(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function text(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

// A resource's readable label: its first naming field, else a person's
// « last_name first_name ». Undefined when nothing obvious names it — the
// picker then shows the id alone.
export function itemLabel(item: unknown): string | undefined {
  if (!isItem(item)) return undefined;
  const person = [text(item.last_name), text(item.first_name)]
    .filter(Boolean)
    .join(" ");
  return LABEL_FIELDS.map((f) => text(item[f])).find(Boolean) ?? (person || undefined);
}

// A list response is a root array or a HAL collection. An object's own arrays
// (an options response's `compartments`, a FATCA record's `us_indicia`) are not
// resources, even when its path ends in a static segment.
function listItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!isItem(body) || !isItem(body._embedded)) return [];
  return Object.values(body._embedded).find(Array.isArray) ?? [];
}

// The id + readable label of each object item of a list response body.
export function extractSeenItems(body: unknown): SeenItem[] {
  const items = listItems(body);
  const out: SeenItem[] = [];
  for (const raw of items) {
    if (!isItem(raw)) continue;
    const id = text(raw.id);
    if (!id) continue;
    out.push({ id, label: itemLabel(raw) });
  }
  return out;
}

export interface FetchableIdList {
  apiId: string;
  operationId: string;
  noun: string; // « Recharger les <noun> »
}

// Lists the picker fetches itself, by input name: they rarely change, so they
// are fetched once and kept as seen ids instead of making the user run them.
// Their ids are offered on that input only.
export const FETCHABLE_ID_LISTS: Record<string, FetchableIdList> = {
  product_id: { apiId: "product", operationId: "listProducts", noun: "produits" },
};

export function seenIdsFor(apiId: string, operationId: string): SeenId[] {
  return seenCache[`${apiId}::${operationId}`] ?? [];
}

// An input that holds a resource id: a uuid, or a `*_id` name (the premium
// bodies' `payment_method_id` carries no format).
export function isIdField(name: string | undefined, schema?: JsonSchema): boolean {
  return schema?.format === "uuid" || !!name?.endsWith("_id");
}

# Design

## Context

`lib/id-collector.ts` keeps `Record<apiId, CollectedId[]>` (3 per API) under store key `packrest.collected-ids`, as a synchronous cache hydrated by `TauriProvider`, with `COLLECTED_IDS_CHANGED_EVENT` for re-reads. `hooks/use-request-execution.ts` calls `recordCreatedId` after any 2xx POST whose body carries an `id` — including submit / update / cancel POSTs, which re-record the resource they act on. The topbar `components/IdCollector.tsx` lists the cache.

`components/FieldCombobox.tsx` (via `FieldOptionsContext`) *replaces* an input with a select-only trigger; it fits a closed catalogue, not an id the user may also type or paste. Body leaves render in `components/SchemaField.tsx`; path/query params render separately as plain `<Input>`s in `RequestBuilder`'s params section.

In the synced specs, ids are consistently `format: uuid` and named `<resource>_id`; the one gap is `payment_method_id` in the premium bodies, which has no format.

## Goals / Non-Goals

**Goals:**
- One picker component used by both renderers, reading the collector directly.
- Created-id data stays readable by the existing topbar without migration.

**Non-Goals:**
- Resource-type matching between a field and the ids offered (explicitly rejected: every input offers everything).
- Capturing ids from the parcours runner (`callOperation`) or HAL follows; paging through lists.

## Decisions

### Seen ids in a second collection, same module

`lib/id-collector.ts` gains `Record<"<apiId>::<operationId>", SeenId[]>` under a new key `packrest.seen-ids`, hydrated by the same `bootstrapIdCollector()` and announced by the same event. `SeenId = { id, label, apiId, operationId, operationLabel, seenAt }`. `recordSeenIds(source, items)` puts the response's items first, dedupes by id, caps at 20 per operation. `clearCollectedIds()` with no argument clears both; with an apiId (the topbar's per-API trash) it clears that API's created and seen ids.

Alternative: one merged collection with a `source` field — rejected, it changes the shape the topbar reads and mixes two retention rules in one list.

### Collection detection and labels are pure helpers

- `isCollectionPath(path)`: true when the last path segment is static (`/funds`, `/individuals/{person_id}/payment-methods`), false when it is a `{param}` — the same split the spec uses between list and item endpoints.
- `extractSeenItems(body)`: the items of a root array or of the first array under `_embedded` — every list of the synced specs is a HAL collection. Not `findCollectionArray`'s any-array fallback: `…/premiums/options`, `…/savings` and `…/fatca` end in a static segment yet return one object whose own arrays (`compartments`, `management_modes`, `us_indicia`) are not resources; it also keeps the collector free of `lib/parcours.ts`. Then per object item: `id` (string or number), label = first non-empty of `name`, `label`, `title`, `commercial_name`, `contract_number`, `isin`, `code`, else `last_name` + `first_name` joined by a space, else no label (the picker shows the id alone; entries stored with the id as label are read the same way). The same `itemLabel` names a created resource from its POST response body, stored as `CollectedId.name` beside the operation label — the topbar and the picker show it.

Both live in `lib/id-collector.ts` and are unit-tested without a store (the module's persistence is a no-op under Vitest's node environment).

### Action POSTs don't record

`use-request-execution` passes the request's path-param values; `recordCreatedId` skips when the returned id equals one of them, and otherwise moves an id already present for that API to the top instead of duplicating it (keeping its original label — the creating operation). Cap 3 → 5 per API. Existing stored entries are read as is.

### `IdPicker`: an icon button beside the input

`components/IdPicker.tsx` renders a small outline icon button that opens a `Popover` + `Command` (the primitives `FieldCombobox` already uses) with a `CommandInput` search over label, id and operation. Groups: API title (from `listApiSummaries`, as the topbar does), then source — « Créés · <operation> » / « Vus · <operation> ». Entries: label, id shortened to its first 8 characters, relative time. The current form's API group is listed first: `RequestBuilder` knows `apiId` and passes it down to the path-param renderer directly and to `SchemaField` leaves through a minimal context (SchemaField has no apiId otherwise). Selection calls the input's existing `onChange` with the full id.

The predicate `isIdField(name, schema)` — `format === "uuid"` or `name` ends with `_id` — is shared by both mount points. `SchemaField` shows the picker only in the plain-input branch, so a `FieldCombobox` field (parcours `fieldOptions`) keeps its list and no button; `const` / enum / readOnly leaves never reach that branch.

Alternative: extend `FieldCombobox` with free-text entry — rejected, it changes the parcours' closed pickers and merges two interactions (choose from a catalogue vs. reuse a remembered id).

### Lists the picker fetches itself

The product catalogue rarely changes and `product_id` is the first id a contract needs, yet nothing else in the request tester collects it. `FETCHABLE_ID_LISTS` (in `lib/id-collector.ts`) maps an input name to a list operation — only `product_id` → `product` / `listProducts`. The picker runs it through `callOperation` (its own scoped token, as the parcours pickers do) on first opening when that operation has no seen ids, and on « Recharger les produits ». The items are recorded with `recordSeenIds(…, { replace: true })`: the unfiltered first page (default `limit` 20, the same as the seen cap) is the whole truth, so a product no longer listed disappears. The persisted seen ids are the cache; there is no expiry. Such a list and its input are reserved to each other: the `product_id` picker lists only the products, and other pickers skip that group, even when the user ran it by hand — a product id is never what `subscriber_id` wants, and the auto-fetch would otherwise push products into every picker. This is the one exception to « no matching ».

### One entry point, two callers

`recordResponseIds(source, res)` holds the whole rule — created id of a 2xx POST (path-param skip, name via `itemLabel`), items of a 2xx GET on a list path. `use-request-execution` calls it after every run; `callOperation` calls it only when given `collectIds: <origin>`, which the auto-runner passes on its step calls (not on its fund/product lookups) and the documents step on `createDocument` (decisions return no id). `resolveAndAuth` already resolves the endpoint, so it returns the path, summary and consumed path-param values the rule needs. The parcours page passes `idOrigin="parcours"` to its `RequestBuilder`, so manual and semi-auto steps are marked the same way; the mark is `CollectedId.origin`, rendered as a « Parcours » badge.

## Risks / Trade-offs

- [Long lists in every picker, since nothing is matched] → Search box, grouping, the form's API first, and the 5 / 20 caps keep it bounded (≈ 9 APIs × (5 + a few lists × 20)).
- [A list returning objects without `id` but with `<resource>_id`] → Not collected; acceptable for these contracts, where collection items carry `id`. Revisit if a synced spec says otherwise.
- [Labels guessed from field names] → Falls back to the id, never to an empty label.
- [Seen data persisted (names, contract numbers) in `packrest.json`] → Same unencrypted store as the existing ids and secrets; « Tout vider » removes it.

## Migration Plan

None: the created-id key keeps its shape (entries beyond 5 are trimmed on the next record), the seen-id key starts empty.

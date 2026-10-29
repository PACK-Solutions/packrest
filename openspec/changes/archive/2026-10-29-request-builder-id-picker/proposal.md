# Proposal

## Why

Reusing an id today means opening the topbar « Collecteur d'IDs », finding the right entry, copying it and pasting it into the field. And the collector only holds ids created by a POST, so the ids a management act needs most often — a fund, a preset allocation, a payment method, an existing contract or person — are never in it: users run the list endpoint in another window and copy from the raw response. Picking the id directly from the field, from both created and listed resources, removes both detours.

## What Changes

- Every id input of the request form — a writable body leaf or a path param that is `format: uuid` or named `*_id` — gets a picker button next to it; the input stays free text (typing and pasting still work).
- The picker lists, with a search box, every id the app has collected, grouped by API then by the operation they came from, the form's own API first. Picking fills the input.
- The collector also records **ids seen in list responses**: the items of a 2xx GET on a collection endpoint, each with a readable label (name, contract number, person name, ISIN…), the 20 most recent per list operation.
- **Created** ids: the 5 most recent per API (was 3), and a POST that only acts on an existing resource (its returned id is one of its own path params — submit, update, cancel…) no longer adds a duplicate entry; the same id is never listed twice in a group.
- The topbar collector shows the new created-id count; « Tout vider » also clears the seen ids.
- No matching between a field and a resource type: every id input offers the whole collection.
- Ids created by the guided parcours — its auto-run, the forms of its steps and its documents step — are collected too, marked with a « Parcours » badge.
- Out of scope: HAL-followed GETs, items beyond the fetched page, query params.

## Capabilities

### New Capabilities

- `id-reuse`: collecting resource ids from created and listed resources, and offering them for picking in the request form's id inputs.

### Modified Capabilities

(none)

## Impact

- `lib/id-collector.ts` — created-id dedupe and cap, a second collection for seen ids (new store key), pure extraction helpers.
- `hooks/use-request-execution.ts` — records seen ids after a collection GET; skips action POSTs.
- `lib/operation-fetch.ts` — `callOperation` collects ids on request (`collectIds`); `lib/parcours-auto.ts` asks for it on step calls.
- New `components/IdPicker.tsx`; mounted from `components/SchemaField.tsx` (string leaves) and the path-param inputs of `components/RequestBuilder.tsx`.
- `components/IdCollector.tsx` — wording (5 per API) and « Tout vider » scope.

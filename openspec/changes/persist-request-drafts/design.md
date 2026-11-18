# Design

## Context

`RequestBuilder` already supports draft round-tripping for the parcours: `initialDraft` (`params` + `body`) seeds its state on mount, and `onDraftChange` fires **once, on unmount**, with the latest `{ params, body }`. Custom headers live in builder state (`SavedHeader[]`) and are only ever set by an import seed. `app/endpoint/page.tsx` passes neither prop, and unmounts the builder (skeleton) on every navigation — so every visit starts blank.

Persistence follows an established pattern: `lib/id-collector.ts` keeps a synchronous in-memory cache over `lib/store.ts` (tauri-plugin-store, localStorage fallback), hydrated by `TauriProvider` before any page renders, persisted fire-and-forget.

The Bruno importer (`app/collections/page.tsx`) writes a one-shot `IMPORT_SEED_KEY` to sessionStorage and navigates to the endpoint page; the builder consumes it on mount and applies it only over blank fields.

## Goals / Non-Goals

**Goals:**
- Endpoint-page drafts that survive navigation and restarts, with the builder still storage-agnostic.
- No behaviour change for the parcours.

**Non-Goals:**
- Live sync of drafts between windows open at the same time.
- Persisting the response, selected scopes or HAL follow stack.
- Any id-picking affordance (that is L1, a separate change).

## Decisions

### `lib/request-drafts.ts`, modelled on the id collector

One store key (`packrest.request-drafts`) holding `Record<"<apiId>::<operationId>", RequestDraft>` with `RequestDraft = { params, body, headers, environment, updatedAt }`. Sync API (`loadDraft`, `saveDraft`, `deleteDraft`) over a cache hydrated by `bootstrapRequestDrafts()` in `TauriProvider`. Saving an *empty* draft (all params blank, no body content, no headers) deletes it instead, so merely opening an operation never creates one. Capped to the 50 most recently edited drafts, oldest evicted on save, to bound the store file.

Alternatives: sessionStorage — rejected, lost on restart and per-window, while users work across several windows; one store key per draft — rejected, no cheap way to list or cap them.

### Key by operation, record the environment

Keyed on `apiId + operationId` only. The environment is stored in the draft and named in the banner when it differs from the current one, rather than being part of the key: keying by environment would make a draft vanish the moment the user switches dev ↔ rec, which reads as data loss.

### Builder reports edits through a new optional `onDraftEdit`

`RequestBuilder` gains `onDraftEdit?(draft)`, fired from an effect on params / body / custom headers changes (not on the initial mount state). The endpoint page debounces it (~500 ms) into `saveDraft`, and also saves the final snapshot from the existing `onDraftChange` on unmount, which flushes a pending debounce. `initialDraft` gains an optional `headers` field.

Alternative: make `onDraftChange` fire live — rejected, the parcours relies on its single unmount call (`skipDraftSaveRef` on mode switch) and would `setState` on every keystroke.

### Reset by remount

« Réinitialiser » deletes the draft and bumps a `key` on the builder, which is the only way to also clear picked files and every derived state. The unmount triggered by that remount fires `onDraftChange` with the old snapshot, so the page ignores that one call (a ref flag, as the parcours does with `skipDraftSaveRef`).

### Import detection on the page

Before choosing `initialDraft`, the endpoint page peeks (without consuming) at `IMPORT_SEED_KEY`; if it targets the current api/op, it deletes the draft and mounts the builder without one, so the builder's existing seed path applies the import to a blank form. Keeps the importer untouched and the rule next to the restore logic.

## Risks / Trade-offs

- [Two windows edit the same operation] → Last write to the store wins; each window keeps its own cache until restart. Acceptable for the reported use (different operations per window); noted as a non-goal.
- [Custom headers persisted unencrypted] → Same protection level as the client secrets and token already in `packrest.json` (see CLAUDE.md « Known limitations »).
- [A stale draft surprises a user who expected the contract's empty form] → The banner and « Réinitialiser » make the state explicit; an empty draft is never stored.
- [Body shape changed by a spec sync since the draft was saved] → The restored body is plain data rendered through `SchemaField`; unknown keys behave as they do for an imported body. No migration attempted.

## Migration Plan

None: a new store key, absent on existing installs, means "no drafts". Rollback leaves an unused key in `packrest.json`.

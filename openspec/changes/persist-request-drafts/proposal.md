# Proposal

## Why

A single management act (e.g. a one-time premium) needs ids from several other endpoints — the contract, the fund or preset allocation, the person's payment method. Leaving the endpoint page to look one up wipes the form, so users today keep several windows open side by side just to avoid retyping. Restoring what was typed on return removes the main reason for that workaround and makes the tool usable for functional users outside the guided parcours.

## What Changes

- The standalone endpoint page restores the user's last input for that operation — path/query params, JSON body (including multipart metadata fields) and custom headers — when the user comes back to it, including after an app restart.
- Input is saved while the user types (debounced) and when leaving the page, so a crash or window close loses at most the last moment of typing.
- A restored form is announced by a banner showing when the draft was last edited, with a « Réinitialiser » action that discards the draft and returns the form to its empty, contract-driven state.
- A Bruno import into an operation discards that operation's draft first, so the imported request is shown as-is instead of merged into stale values.
- Not restored: picked files (not serialisable), the response, the selected scopes, HAL navigation.
- The guided parcours is unchanged: it keeps its own per-step drafts.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `request-builder`: adds draft persistence and reset on the standalone endpoint page.

## Impact

- New `lib/request-drafts.ts` — synchronous cache over `lib/store.ts`, same shape as `lib/id-collector.ts`, hydrated by `TauriProvider` before render.
- `components/RequestBuilder.tsx` — accepts restored custom headers and reports edits while typing (the existing unmount-only `onDraftChange` used by the parcours stays as is).
- `app/endpoint/page.tsx` — wires restore / save / reset and the banner.
- `app/collections/page.tsx` (or the endpoint page's import detection) — import discards the matching draft.
- Store file `packrest.json` gains one key; drafts are unencrypted like the rest of that file (custom headers may hold values the user typed there).

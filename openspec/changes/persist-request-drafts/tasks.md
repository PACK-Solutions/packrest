# Tasks

## 1. Draft store (`lib/request-drafts.ts`)

- [ ] 1.1 Create the module modelled on `lib/id-collector.ts`: `RequestDraft { params, body, headers, environment, updatedAt }` keyed `<apiId>::<operationId>` under store key `packrest.request-drafts`; sync `loadDraft` / `saveDraft` / `deleteDraft`, fire-and-forget persistence, `bootstrapRequestDrafts()` (idempotent). Verify `npm run typecheck` passes.
- [ ] 1.2 In `saveDraft`, delete instead of storing when the draft is empty (every param blank, no body content, no headers), and evict the oldest by `updatedAt` beyond 50 drafts. Add `lib/__tests__/request-drafts.test.ts` covering save/load round-trip, empty → deleted, and eviction at the cap; verify `npm run test:unit` passes.
- [ ] 1.3 Await `bootstrapRequestDrafts()` in `components/tauri-provider.tsx` next to `bootstrapIdCollector()`. Verify under `npm run tauri:dev` that the app still starts past the splash.

## 2. Builder hooks (`components/RequestBuilder.tsx`)

- [ ] 2.1 Extend `initialDraft` with optional `headers` (initial `customHeaders` state) and include `headers` in the snapshot passed to `onDraftChange`. Verify `npm run typecheck` passes and the parcours still restores a step's params/body after navigating away and back (`npm run tauri:dev`).
- [ ] 2.2 Add optional `onDraftEdit(draft)` fired from an effect on `paramValues` / `bodyValue` / `customHeaders` changes, skipping the initial mount. Verify `npm run typecheck` passes and that the parcours (which does not pass it) behaves unchanged.

## 3. Endpoint page wiring (`app/endpoint/page.tsx`)

- [ ] 3.1 On load, peek (do not consume) `IMPORT_SEED_KEY`: when it targets the current api/op, `deleteDraft` and mount without a draft; otherwise pass `loadDraft(...)` as `initialDraft`. Verify under `npm run tauri:dev` that importing a Bruno request onto an operation with a draft shows only the imported values.
- [ ] 3.2 Save via `onDraftEdit` debounced (~500 ms) and via `onDraftChange` on unmount (flushing any pending debounce), recording the current environment. Verify under `npm run tauri:dev`: type into « createPremium », open another endpoint, come back — the input is restored; type, quit the app within a second or two, relaunch — the input is restored.
- [ ] 3.3 Show the restoration banner (last-edited time, environment when it differs from the current one) with « Réinitialiser »: delete the draft, ignore the unmount snapshot of the outgoing builder, bump the builder `key`. Verify under `npm run tauri:dev`: reset clears params, body, headers and a picked file, the banner disappears, and reopening the operation shows an empty form with no banner.

## 4. Docs and checks

- [ ] 4.1 Update `CLAUDE.md`: add `request-drafts.ts` to the `lib/` list and replace « Requests are **not persisted** » in Known limitations with the draft behaviour (endpoint page only; files, response and scopes not kept). Verify the text matches the implemented behaviour.
- [ ] 4.2 Run `npm run typecheck`, `npm run test:unit`, `npm run build` and `cargo check` in `src-tauri/`; all pass.

## Workflow follow-up

- Bump the release per the project's convention once the user approves the commit.
- Archive the change after review.

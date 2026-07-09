## 1. Phase 1 — pure-function lift (lib/)

- [x] 1.1 Create `lib/curl.ts` and move `buildCurl`, `curlForm`, `escapeSingleQuotes`, `managedContentType`, `maskToken` from `RequestBuilder.tsx` (exported)
- [x] 1.2 Create `lib/multipart.ts` and move `buildMultipart`, `formatUploadSize`
- [x] 1.3 Update `RequestBuilder.tsx` (and any other consumers of `buildCurl`) to import from the new modules
- [x] 1.4 `npm run typecheck` passes

## 2. Phase 2 — custom-hook extraction (hooks/)

- [x] 2.1 Create `hooks/use-token.ts` (`token`, `tokenError`, `fetchingToken`, `selectedScopes`, `getToken`, `buildLiveHeaders`); return stable callbacks
- [x] 2.2 Create `hooks/use-request-execution.ts` (`response`, `error`, `running`, `uploading`, `run`); return stable callbacks
- [x] 2.3 Create `hooks/use-hal-navigation.ts` (`followStack`, `followLink`, `navBack`, `navJumpTo`, `navToOperation`) — followStack ownership consolidated into use-request-execution to keep hook composition acyclic (behavior unchanged)
- [x] 2.4 Wire the three hooks into `RequestBuilder.tsx`, removing the inlined state/handlers

## 3. Remove the ref indirection

- [x] 3.1 Delete `runRef`/`escRef`; make the keyboard-shortcut effect depend directly on the stable hook callbacks

## 4. Verify

- [x] 4.1 `npm run typecheck` (pass) + `npm run build` static export (pass)
- [x] 4.2 Smoke verified: browser pass (`npm run dev` + Playwright) — endpoint mounts the refactored `RequestBuilder` cleanly, zero console errors, "Copier en curl" reflects typed body + composed URL; and the desktop flows (token acquisition, real run incl. multipart upload, HAL follow/back/jump) confirmed manually in `npm run tauri:dev`.
- [x] 4.3 Confirm `RequestBuilder` cognitive complexity is below the health threshold — measured with `eslint-plugin-sonarjs` cognitive-complexity: component body **18→9**, `handleExportBruno` **16→gone** (decomposed); every function across `RequestBuilder.tsx` + all new hooks/lib is now **≤12** (threshold 15).

## 5. Complexity-driven extraction (resolves design Open Question)

The three planned hooks relocated the branch-heavy async logic but, by per-function
tooling (no rollup), left the component body at 18 and `handleExportBruno` at 16 —
both >15. To bring **every** function under the threshold:

- [x] 5.1 Move the "describe the current request" actions to `hooks/use-request-actions.ts` (`exportBruno`, `copyCurl`, `saveContextPath`), decomposing the Bruno-request assembly into `buildExportParams` / `buildBrunoRequest` / `buildCurlCommand` so no function exceeds 15
- [x] 5.2 Move the `effective*` request derivation + `currentResponse` + `isFollowing` into `useRequestExecution` (returned, not recomputed in the component)
- [x] 5.3 Add `buildManagedHeaders` to `lib/curl.ts`; replace the inline `managedHeaders` spread
- [x] 5.4 Extract the JSON-vs-multipart body branch into a `RequestBodyTab` sub-component
- [x] 5.5 Re-measure: component body 18→9; all functions ≤12; `npm run typecheck` + `npm run build` pass

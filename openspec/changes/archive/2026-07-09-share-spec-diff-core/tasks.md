## 1. Shared core

- [x] 1.1 Create `lib/spec-diff-core.mjs` with `HTTP_METHODS`, `stableStringify`, `parseDoc`, `diffSpec` (results sorted), importing only `js-yaml`
- [x] 1.2 Add `lib/spec-diff-core.d.ts` typing `SpecDiff`, `diffSpec`, and `parseDoc` (written as `.d.mts` so bundler resolution pairs it with the `.mjs` import)

## 2. Repoint the runtime

- [x] 2.1 `lib/spec-diff.ts` re-exports `diffSpec` and `SpecDiff` from the core; delete the inline algorithm
- [x] 2.2 Confirm consumers still typecheck: `lib/sync.ts`, `lib/gitlab.ts`, `components/SyncDiff.tsx`, `app/settings/page.tsx`

## 3. Repoint the CLI

- [x] 3.1 `scripts/copy-specs.mjs` imports `diffSpec` (and helpers) from `lib/spec-diff-core.mjs`; delete the inline mirror
- [x] 3.2 Keep `summarizeDiff` and the `sync-constants.json` source-resolution logic in the script

## 4. Verify

- [x] 4.1 `npm run typecheck` (pass)
- [x] 4.2 `npm run sync-specs` — CLI still prints the per-API diff summary
- [x] 4.3 `npm run build` static export (pass)

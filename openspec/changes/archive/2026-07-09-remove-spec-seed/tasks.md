## 1. Remove the seed runtime

- [x] 1.1 In `lib/specs-fs.ts`, delete `seedSpecsIfEmpty` and `fetchManifest`; make `listSpecFiles` return `[]` and `readSpecFile` return `null` outside Tauri (drop the `/specs/…` fetch fallbacks); keep `writeSpecFile` a no-op outside Tauri
- [x] 1.2 In `components/tauri-provider.tsx`, remove the `seedSpecsIfEmpty` import and its startup call (keep the storage/id-collector bootstrap)

## 2. Remove the build-time seed generation

- [x] 2.1 Delete `scripts/copy-specs.mjs`
- [x] 2.2 Remove `predev`, `prebuild`, and `sync-specs` from `package.json` scripts
- [x] 2.3 Delete bundled assets `public/specs/*.yaml` and `public/specs/manifest.json`; remove their entries from `.gitignore`

## 3. Re-inline the spec diff

- [x] 3.1 Move the algorithm from `lib/spec-diff-core.mjs` into `lib/spec-diff.ts` as TypeScript (import `HTTP_METHODS` from `lib/types`, keep sorted results and the `SpecDiff` export)
- [x] 3.2 Delete `lib/spec-diff-core.mjs` and `lib/spec-diff-core.d.mts`; confirm `lib/sync.ts`, `lib/gitlab.ts`, `components/SyncDiff.tsx`, `app/settings/page.tsx` still import from `lib/spec-diff`

## 4. Docs

- [x] 4.1 Update `CLAUDE.md` (Sources of truth, Before editing, Commands) to drop the seed / `copy-specs.mjs` / bundled `public/specs/` narrative and describe GitLab + local as the only sources

## 5. Verify

- [x] 5.1 `npm run typecheck` (pass)
- [x] 5.2 `npm run build` static export (pass; no predev/prebuild seed step runs)
- [x] 5.3 In `npm run tauri:dev`, confirm a spec store with no files opens to the empty state, and a GitLab or local sync populates the API list _(confirmed manually)_

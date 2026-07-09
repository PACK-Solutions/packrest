## Why

The app ships a **bundled seed** of OpenAPI specs: `scripts/copy-specs.mjs` copies `<specsDir>/<api>/v1/openapi.bundle.yaml` into `public/specs/` (+ a `manifest.json`) at predev/prebuild, the static export bundles them, and `seedSpecsIfEmpty()` copies them into the writable app-data store on first launch. Outside Tauri, reads fall back to these bundled assets directly.

This seed is now redundant and actively harmful:

- **Two real sources already exist** — GitLab releases (`lib/gitlab.ts`) and a local source directory (`lib/sync.ts`). The seed is a third, frozen copy that goes stale the moment it ships and can silently mask what the user actually synced.
- **It bakes API contracts into the binary.** A shipped `.app` carries whatever specs existed at build time; users can't tell seeded specs from synced ones.
- **It couples the build to a local `specsDir`.** `predev`/`prebuild` fail-soft but noisily when the source dir is absent, and the whole `copy-specs.mjs` machinery (with its manifest emit and diff print) exists only to feed the seed.
- **The empty-first-launch UX is already built.** The home page and sidebar already render an "Aucune spec OpenAPI chargée" state that points the user to sync — so no seed is needed to make the first launch coherent.

## What Changes

- **Remove the seed end to end**: delete `seedSpecsIfEmpty()`, the bundled `public/specs/` assets, `scripts/copy-specs.mjs`, the `predev`/`prebuild`/`sync-specs` npm scripts, and the `public/specs/` `.gitignore` entries.
- **Specs come only from GitLab (primary) or the local source directory (fallback).** Both remain user-triggered syncs into the writable app-data store; nothing else populates it.
- **First launch starts empty** until the user syncs, using the existing empty-state UI.
- **Drop the non-Tauri bundled-asset fallback** in `lib/specs-fs.ts` (`fetchManifest` and the `/specs/…` fetches). Outside Tauri there is no writable store and no seed, so the API list is simply empty there — consistent with "Tauri APIs disabled in the browser".
- **Re-inline the spec diff.** With the build-time CLI (`copy-specs.mjs`) gone, the plain-JS `lib/spec-diff-core.mjs` + `lib/spec-diff-core.d.mts` split loses its only reason to exist (it was the shape that let a pre-build `node` script share the algorithm). Fold it back into `lib/spec-diff.ts` as normal TypeScript.

## Capabilities

### New Capabilities
- `spec-sourcing`: where the app's OpenAPI specs come from — GitLab releases and a local source directory only, written to the writable app-data store, with no bundled seed and an empty state until the first sync.

### Modified Capabilities
- `spec-diff-consistency`: the "build-time CLI" entry point is removed, so the diff has a single runtime implementation rather than two synchronized entry points.

## Impact

- **Deleted:** `scripts/copy-specs.mjs`, `public/specs/*.yaml`, `public/specs/manifest.json`, `lib/spec-diff-core.mjs`, `lib/spec-diff-core.d.mts`.
- **`lib/specs-fs.ts`** — remove `seedSpecsIfEmpty` and `fetchManifest`; `listSpecFiles`/`readSpecFile`/`writeSpecFile` become Tauri-only (empty/no-op outside Tauri).
- **`components/tauri-provider.tsx`** — drop the `seedSpecsIfEmpty()` startup call.
- **`lib/spec-diff.ts`** — absorbs the algorithm again (typed TS, sorted results preserved).
- **`package.json`** — remove `predev`, `prebuild`, `sync-specs`.
- **`.gitignore`** — drop `public/specs/*.yaml` and `public/specs/manifest.json`.
- **`CLAUDE.md`** — update the "Sources of truth", "Before editing", and command sections that document the seed and `copy-specs.mjs`.
- **Unchanged:** GitLab and local sync flows, the spec-diff semantics, and the empty-state UI.

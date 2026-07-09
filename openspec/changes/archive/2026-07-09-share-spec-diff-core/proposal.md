## Why

The structural spec-diff algorithm (~80 lines: `stableStringify`, `parseDoc`, `diffSpec`) is duplicated across two files:

- `lib/spec-diff.ts` — the runtime diff used by `lib/sync.ts`, `lib/gitlab.ts`, `components/SyncDiff.tsx`, and `app/settings/page.tsx`.
- `scripts/copy-specs.mjs` — the build-time CLI diff. It is plain JS by necessity: `tsconfig.json` sets `allowJs: false`, and the script runs under plain `node` at predev/prebuild — before any TS build — so it cannot import the TS module.

The two copies have **already drifted**: `lib/spec-diff.ts` `.sort()`s all five result arrays (`endpointsAdded`, `endpointsRemoved`, `endpointsChanged`, `scopesAdded`, `scopesRemoved`); the `.mjs` copy does not. This is currently harmless because the CLI only prints counts via `summarizeDiff`, but it means the "keep the two algorithms in step" promise the source comments make is already broken. Any future edit to one side silently diverges the other.

## What Changes

- Extract the pure algorithm into a shared, dependency-light ES module `lib/spec-diff-core.mjs` (plain JS: `HTTP_METHODS`, `stableStringify`, `parseDoc`, `diffSpec`), with the sorted-result behavior as the single definition.
- `scripts/copy-specs.mjs` imports the core directly and drops its inline mirror; it keeps its own `summarizeDiff` presentation (French, count-oriented, CLI-only).
- `lib/spec-diff.ts` re-exports the typed surface from the core, backed by a hand-written `lib/spec-diff-core.d.ts`. This keeps `allowJs: false` intact under `moduleResolution: bundler` and preserves the exported `SpecDiff` interface for existing consumers.
- The runtime diff behavior is unchanged. The CLI gains the previously-missing stable ordering, which only makes its output deterministic.

The drift is fixed by construction: there is one implementation, so the two entry points cannot diverge.

## Capabilities

### New Capabilities
- `spec-diff-consistency`: the runtime and build-time structural spec diffs derive from a single implementation and produce identical results for identical inputs.

## Impact

- New: `lib/spec-diff-core.mjs`, `lib/spec-diff-core.d.ts`.
- `lib/spec-diff.ts` — becomes a thin typed re-export; the `SpecDiff` type stays stable for `lib/sync.ts`, `lib/gitlab.ts`, `components/SyncDiff.tsx`, `app/settings/page.tsx`.
- `scripts/copy-specs.mjs` — imports the core; the inline algorithm is deleted; `summarizeDiff` and the source-resolution logic stay.
- Precedent already exists for shared/mirrored logic here: `sync-constants.json` is consumed by both `lib/sync.ts` and `copy-specs.mjs`.

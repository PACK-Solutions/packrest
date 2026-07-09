## Context

Specs reach the app through three paths today: the bundled seed (`copy-specs.mjs` → `public/specs/` → `seedSpecsIfEmpty()`), GitLab releases (`lib/gitlab.ts`), and a local source dir (`lib/sync.ts`). Only the last two are live sources the user controls; the seed is a build-time snapshot that duplicates them and drifts. The writable app-data store (`$APPDATA/specs/<api>.yaml`, via `lib/specs-fs.ts`) is the single runtime source of truth; the seed only exists to pre-fill it on first launch and to give plain-browser `next dev` something to read.

Removing the seed is mostly deletion. The one non-obvious coupling is `lib/spec-diff-core.mjs`: it was split out of `lib/spec-diff.ts` specifically so `copy-specs.mjs` (plain `node`, pre-build, `allowJs:false`) could share the diff algorithm. Delete the CLI and that justification is gone.

## Goals / Non-Goals

**Goals:**
- Specs come only from GitLab (primary) and the local source dir (fallback), written to the app-data store.
- No bundled specs, no manifest, no first-launch seeding, no `copy-specs.mjs`.
- First launch is coherent when empty (reuse the existing empty state).
- Leave the diff algorithm in one place after the CLI consumer is gone.

**Non-Goals:**
- Changing the GitLab or local sync flows, their UI, or the diff semantics.
- Auto-syncing on first launch (even when a GitLab token is configured) — the user triggers sync; the empty state guides them.
- Keeping plain-browser `next dev` able to display specs (it has no writable store and now no seed; empty API list there is acceptable, matching the existing "Tauri APIs disabled in the browser" stance).

## Decisions

### Delete the seed rather than gate it behind a flag
The seed has no remaining use once GitLab + local exist and the empty state is built. A flag would keep the `copy-specs.mjs`/manifest/bundled-asset machinery alive for a path nothing needs. Remove it outright: `seedSpecsIfEmpty`, `fetchManifest`, `public/specs/`, `copy-specs.mjs`, and the `predev`/`prebuild`/`sync-specs` scripts.

### `specs-fs` becomes Tauri-only
`fetchManifest` and the `/specs/…` fetch fallbacks in `listSpecFiles`/`readSpecFile` served only the bundled assets. With those gone they read nothing useful, so drop the non-Tauri branches: `listSpecFiles` → `[]`, `readSpecFile` → `null`, `writeSpecFile` stays a no-op outside Tauri. Consumers already tolerate an empty list (empty-state UI).

### Re-inline the diff into `lib/spec-diff.ts`
The `.mjs` + hand-written `.d.mts` indirection existed only for the pre-build node CLI. With `copy-specs.mjs` deleted, fold the algorithm back into `lib/spec-diff.ts` as ordinary TypeScript (importing `HTTP_METHODS` from `lib/types`, sorted results preserved), and delete `lib/spec-diff-core.mjs` and `lib/spec-diff-core.d.mts`. This keeps a single implementation — now trivially, because there is a single consumer.

### `spec-diff-consistency` narrows to the runtime
That capability asserted the runtime and the build-time CLI derive from one implementation and agree. The CLI no longer exists, so the "single-source across two entry points" and "sorted from both entry points" requirements are removed; the fault-tolerance requirement stays (still true of the runtime diff).

## Risks / Trade-offs

- **First launch shows no APIs until a sync.** Accepted: the empty state already explains how to sync; GitLab/local are one click away.
- **`next dev` in a browser shows no specs.** Accepted and already implied by the platform split; only `npm run tauri:dev` is a faithful environment.
- **Losing the build-time diff print.** Minor: it only ever summarized seed changes, which no longer happen; runtime sync still reports per-API diffs in the UI.

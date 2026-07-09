## Context

The diff must run in two environments that can't share a TS module today: the Tauri/browser runtime (TS, bundled) and the predev/prebuild CLI (`copy-specs.mjs`, plain `node`, pre-build). The current answer is hand-duplication with a "keep in step" comment — which has already failed (the `.sort()` drift). The fix must produce one implementation reachable from both without flipping global TS config.

## Goals / Non-Goals

- **Goal:** one source of truth for the diff algorithm, importable by both entry points.
- **Goal:** preserve the `SpecDiff` type and all runtime behavior; fix the ordering drift.
- **Non-Goal:** changing `summarizeDiff` / CLI presentation, or the diff's semantics.
- **Non-Goal:** flipping `allowJs: true` (wider blast radius) or adding a test runner just for this.

## Decisions

### Shared plain-JS core + hand-written `.d.ts`

Write the algorithm as `lib/spec-diff-core.mjs` (plain ESM, imports only `js-yaml`). `copy-specs.mjs` imports it directly. `lib/spec-diff.ts` re-exports from it, typed by a companion `lib/spec-diff-core.d.ts`. This keeps `allowJs: false` and works under `moduleResolution: bundler`.

**Alternatives rejected:**
- *Flip `allowJs: true`* — one global config change with repo-wide effects, to solve a two-file problem.
- *Compile `spec-diff.ts` and import the build output in the script* — the script runs before build; brittle ordering dependency.
- *Golden parity test* — no test runner exists; single-source makes parity structural instead of asserted, so a test would guard a problem we've designed out.

### Sorted results are the canonical behavior

The core sorts all five arrays (matching today's `lib/spec-diff.ts`). The CLI adopting this only makes its output deterministic — a strict improvement, no consumer depends on the old unsorted order.

## Risks / Trade-offs

- **Risk:** the `.d.ts` drifts from the `.mjs` shape. *Mitigation:* the surface is tiny (`SpecDiff`, `diffSpec`, `parseDoc`) and `npm run typecheck` catches signature mismatches at the re-export boundary.
- **Risk:** ESM import path differences between the bundler and plain node. *Mitigation:* use an explicit `.mjs` extension in both import sites; verify via `npm run typecheck` and `npm run sync-specs`.

## Migration Plan

Pure refactor, no data/format change. Land the core + `.d.ts`, repoint both consumers, delete the inline copy, verify.

## Open Questions

None outstanding.

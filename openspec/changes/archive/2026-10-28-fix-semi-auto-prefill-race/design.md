# Design

## Context

`app/parcours/page.tsx` resolves the active step's endpoint in an effect keyed on `activeStep` (`loadSpec` → `findEndpoint` → `setLoaded({ stepId, … })`), tracking progress in a plain `loadingEntry: boolean`. The semi pre-fill effect bails while `loadingEntry` is true, then calls `semiPrefillDraft(step, state, activeBodySchema)` and `recordPrefill`, which marks the step in `semiPrefilled` — a step is pre-filled once.

On a step change, the render that first sees the new `activeStep` still carries the previous step's `loadingEntry === false`, and `activeBodySchema` is `undefined` (it is gated on `loaded.stepId === activeStep.id`). The resolution effect's `setLoadingEntry(true)` is not visible to the pre-fill effect in the same commit, so the pre-fill runs without a schema. For a step whose seed supplies path params (`person-address`, `person-bank-account`, …) the resulting draft is non-null, gets recorded, and the once-only rule prevents the real pre-fill. `setMode("semi")` has the same exposure through `activeBodySchemaRef`.

The render path already avoids this: `resolving` (≈L944) treats `loaded.stepId !== activeStep.id` as still resolving. The pre-fill path lacks the equivalent check.

## Goals / Non-Goals

**Goals:**
- One notion of "this step's endpoint resolution has settled", shared by rendering, the pre-fill effect and `setMode`.
- Keep the once-per-step rule intact.

**Non-Goals:**
- Changing `buildAutoDraftForStep`, `sampleFromSchema`, the auto runner, or the persisted `ParcoursState`.
- Repairing drafts already recorded as params-only in existing sessions (manual → semi resets them).

## Decisions

### Tag the settled resolution with its step id

Replace `loadingEntry: boolean` with the id of the step whose resolution has settled (success or failure), e.g. `resolvedStepId: string | null`, set in the same `.then` that sets `loaded`. "Resolved for the active step" is then `resolvedStepId === activeStep.id`, true only after this step's own resolution — whatever it yielded.

- The pre-fill effect waits on it instead of `!loadingEntry`.
- `resolving` derives from it, replacing the `loadingEntry || loaded.stepId !== …` pair.
- `setMode` reads it through a ref (as it does the schema) and pre-fills synchronously only when it holds; otherwise it leaves the step to the effect, which re-runs on the mode change.

Alternatives considered:
- **Guard on `loaded?.stepId === step.id`** — what line 944 does for rendering. Rejected for the pre-fill: on a spec that fails to load `loaded` stays `null`, so the step would never be pre-filled (violates the "pre-fill without a contract" requirement).
- **Don't record a pre-fill built without a schema** — rejected: body-less operations (`person-submit`, `submit-contract`) legitimately have no schema, so they would never be marked and the effect would re-record on every state change.
- **Reset `loadingEntry` synchronously during render on step change** (derived-state pattern) — works, but keeps two pieces of state that must agree; the tagged id makes the stale case unrepresentable.

### An untouched form reports no draft on unmount

Found while verifying under `tauri:dev`: with the pre-fill now landing *after* the builder mounts, React StrictMode's simulated unmount (dev only, `reactStrictMode: true`) made `RequestBuilder` report its initial, empty snapshot through `onDraftChange`, which `saveDraft` wrote over the fresh pre-fill. The builder now reports nothing when its params/body are unchanged since mount — there is nothing new for the host to store — which also covers a real unmount of an untouched form.

Consequence: the mode-switch `skipDraftSaveRef` can no longer assume one `onDraftChange` follows every switch. It is now set only when the mode actually changes (inside the `setMode` updater, after the no-op check), and cleared by an effect on the committed mode, which runs after the outgoing form's unmount in the same commit.

### An optional object holding only consts stays absent

Also found while verifying, and independent of the race (any mode that renders the FATCA / CRS form): `ConstField` self-emits on mount, so the `scale: 5` of the optional `controlling_person.shareholding_percentage` (`Rate`, whose `value` the server requires) posted a half-built object → 400. `ObjectField` now emits `undefined` for an optional object (`required === false`) with nothing beyond its consts, and spreads its consts into it once something else is filled. A scan of the synced specs found no optional object made only of consts (which this would drop) and 24 mixing a const with data (every `allocation_rate` / `deallocation_rate`, fee-waiver `rate`, `shareholding_percentage`), which this fixes. Array rows and `oneOf` variants render without `required`, so an added row is never pruned.

## Risks / Trade-offs

- [A slow spec load delays the pre-fill by the load time] → Acceptable: the form already shows a resolving state for that duration; `loadSpec` is cached per API, so it is one map lookup after the first step of an API.
- [No automated coverage: the page needs synced specs, which neither Vitest nor the browser-only Playwright suite has] → Verify manually under `npm run tauri:dev` (see tasks); keep the change confined to the page's state wiring so `typecheck` + `next build` catch misuse.

## Migration Plan

None. No persisted shape changes; ships in the next patch release.

# Tasks

## 1. Settled-resolution state (`app/parcours/page.tsx`)

- [x] 1.1 Replace `loadingEntry: boolean` with the id of the step whose endpoint resolution has settled (`resolvedStepId: string | null`): cleared when the resolution effect starts, set to `activeStep.id` in the same `.then` that sets `loaded` (success and failure alike), untouched when cancelled. Verify `npm run typecheck` passes.
- [x] 1.2 Derive `resolving` (≈L944) from it (`!!activeStep && resolvedStepId !== activeStep.id`) and keep `stepEntry` as is. Verify under `npm run tauri:dev` that stepping through the parcours in manual mode still shows the resolving state, then the right endpoint, for each step.

## 2. Pre-fill gating (`app/parcours/page.tsx`)

- [x] 2.1 In the semi pre-fill effect, replace the `loadingEntry` bail-out with `resolvedStepId !== step.id` and update its dependency list and comment. Verify `npm run typecheck` passes.
- [x] 2.2 In `setMode`, read the settled id through a ref (alongside `activeBodySchemaRef`) and pre-fill synchronously only when it equals the active step's id; otherwise leave the step to the effect. Verify `npm run typecheck` passes.

- [x] 2.3 In `RequestBuilder`, skip the unmount `onDraftChange` when params and body are unchanged since mount (StrictMode's simulated unmount overwrote the pre-fill in dev). Verify `npm run typecheck` passes.
- [x] 2.4 Set `skipDraftSaveRef` only on an actual mode change and clear it in an effect on the committed mode. Verify `npm run typecheck` and `npm run build` pass.

- [x] 2.5 In `SchemaField`'s `ObjectField`, keep an optional object out of the body while it holds only consts, and inject its consts once it holds anything else (`constProperties` / `hasNonConstContent` in `lib/schema-normalize.ts`, unit-tested). Fixes the 400 « Field 'value' is required … Rate » on the FATCA / CRS steps, whose optional `controlling_person.shareholding_percentage.scale` const self-emitted. Verify `npm run test:unit` passes.

## 3. Verify

- [x] 3.1 Run `npm run typecheck`, `npm run test:unit` and `npm run build`; all pass.
- [x] 3.2 Under `npm run tauri:dev`, from a reset parcours in semi mode: execute « Créer la personne » and confirm « Adresse principale » shows line1 / postal_code / city / country_code, then « Compte bancaire » shows holder name / IBAN / BIC / currency / validity date, and the payment-method and contract steps show their full contract-derived bodies.
- [x] 3.3 Under `npm run tauri:dev`: switch manual → semi on a not-yet-executed address step right after navigating to it and confirm the full body is pre-filled; edit a field, go back a step and return, and confirm the edit is kept (no re-fill).

## Workflow follow-up

- Bump the patch release (1.5.3) per the project's release convention, once the user approves the commit.
- Archive the change after review.

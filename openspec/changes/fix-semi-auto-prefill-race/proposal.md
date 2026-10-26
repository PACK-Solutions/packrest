# Proposal

## Why

Since 1.5.0 the semi-automatic parcours leaves several forms almost empty — users report « Adresse principale » (`person-address`) and « Compte bancaire » (`person-bank-account`) showing only their path params, and the payment-method / contract steps only partially filled. 1.5.0 moved those bodies from hand-written `AUTO_PLAN` literals to `sampleFromSchema`, so the pre-fill now depends on the step's request schema; the pre-fill fires before that schema is resolved for the new step, records a params-only draft, and — because a step is pre-filled only once — never fills the body afterwards. It pushes users back to typing by hand, which is what the semi-automatic mode exists to avoid.

## What Changes

- The semi-automatic pre-fill of a step waits until that step's endpoint resolution has settled (spec + operation resolved, or definitively failed) before building its draft.
- A step is marked as pre-filled only by a draft built against its own resolved contract — never by one built while the resolution in flight still belonged to the previous step.
- The synchronous pre-fill on switching to « semi » applies the same rule: if the active step's contract is not resolved yet, it defers to the regular pre-fill instead of recording a schema-less draft.
- A spec that genuinely fails to load still pre-fills the step with the seed and `AUTO_PLAN` overrides alone, as today.
- Out of scope: the automatic runner (it already awaits the schema), Phase C documents, the product picker pause, the initial premium.

## Capabilities

### New Capabilities

- `parcours-semi-auto`: the semi-automatic pre-fill of parcours steps — what each step's form is filled with, when, and how often.

### Modified Capabilities

(none)

## Impact

- `app/parcours/page.tsx` — the semi pre-fill effect, `setMode`, and the endpoint-resolution state they read.
- No change to `lib/parcours-auto.ts`, `lib/schema-sample.ts`, persisted `ParcoursState` shape, or any API call.
- Existing sessions whose steps were already marked `semiPrefilled` with a params-only draft keep that draft; switching to manual then back to semi (which resets `semiPrefilled`) re-fills them.

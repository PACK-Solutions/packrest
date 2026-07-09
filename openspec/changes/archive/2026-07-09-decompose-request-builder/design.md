## Context

`RequestBuilder` is state-heavy by nature — it is the hub that turns a spec operation into a live request. The problem is not that it holds state, but that *all* of it lives in one function scope with no internal boundaries, so complexity compounds and every concern can reach every other. The state variables already group by concern in declaration order (L118–222), which is why the extraction seams are clean.

## Goals / Non-Goals

- **Goal:** reduce `RequestBuilder`'s cognitive complexity below the health threshold by extracting cohesive units, with no observable behavior change.
- **Goal:** remove the `runRef`/`escRef` stale-closure workaround.
- **Non-Goal:** changing the request/token/HAL/export behavior, the JSX structure the user sees, or any network/security path.
- **Non-Goal:** introducing a state-management library — plain hooks only.

## Decisions

### Two ordered phases, independently shippable

Phase 1 (pure-function lift) is mechanical and near-zero risk: the target functions are *already* module-scope and pure, just co-located in the component file. Doing it first shrinks the file (~200 lines) and clears noise before the behavioral work. Phase 2 (hooks) can land separately after Phase 1 is verified.

### Hook boundaries follow the state clusters

| Hook | Owns | Returns |
| --- | --- | --- |
| `useToken` | `token`, `tokenError`, `fetchingToken`, `selectedScopes` | `getToken()`, `buildLiveHeaders()`, state |
| `useRequestExecution` | `response`, `error`, `running`, `uploading` | `run()`, state |
| `useHalNavigation` | `followStack` | `followLink()`, `navBack()`, `navJumpTo()`, `navToOperation()`, current entry |

`useCallback` (or reducer-backed dispatch) makes the returned callbacks referentially stable so the keyboard-shortcut effect can list them as dependencies directly.

### Ref indirection is a symptom, not a target to preserve

`runRef`/`escRef` only exist to bridge stale closures. Once `run()` and the ESC handler are stable, the effect at L429 depends on them and the refs are deleted — do not port them into the hooks.

## Risks / Trade-offs

- **Risk:** subtle behavior drift during hook extraction (e.g. effect dependency arrays, initial-state timing). *Mitigation:* the `request-builder` regression-guard spec plus the manual smoke checklist (token → run → HAL follow/back → curl → Bruno export) in `npm run tauri:dev`.
- **Trade-off:** more files. Accepted — small, single-purpose hook files are the point.

## Migration Plan

Refactor only; no data/format migration. Ship Phase 1, verify, then Phase 2.

## Open Questions

- Whether the request-input cluster (`baseUrl`, `environment`, `paramValues`, `bodyValue`, `files`, `customHeaders`) also warrants a `useRequestForm` hook, or is left inline in this pass. Deferred — the three hooks above already clear the complexity threshold; a fourth can follow if needed.

## Resolution (post-implementation)

The "three hooks already clear the threshold" assumption did **not** hold under
per-function cognitive-complexity tooling (`eslint-plugin-sonarjs`, which attributes
complexity per function scope without rolling nested functions into the parent). The
three hooks relocated the branch-heavy async logic, but the component body stayed at 18
and `handleExportBruno` sat at 16 — both above 15 — because that complexity lives in the
JSX/derived-const ternaries and the export builder, none of which the three hooks touched.

A fourth extraction pass (Tasks §5) brought every function under the threshold:
`hooks/use-request-actions.ts` (Bruno export / curl / context-path, with the Bruno
assembly split across `buildExportParams` / `buildBrunoRequest` / `buildCurlCommand`);
the `effective*` / `currentResponse` / `isFollowing` derivation moved into
`useRequestExecution`; `buildManagedHeaders` in `lib/curl.ts`; and a `RequestBodyTab`
sub-component for the JSON-vs-multipart branch. Result: component body 18→9, all
functions ≤12.

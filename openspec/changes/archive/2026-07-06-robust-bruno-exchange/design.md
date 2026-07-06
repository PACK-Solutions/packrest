## Context

The Bruno exchange spans three layers, all client-side (static export, no server route):

- `lib/bruno.ts` — serialize/parse opencollection 1.0.0; `ImportSeed` + `IMPORT_SEED_KEY` sessionStorage hand-off; URL/path helpers (`brunoUrlToPath`, `bruPathToOpenApi`).
- `lib/bruno-export.ts` — spec → collection tree (`buildBrunoCollection`); `endpointToBrunoRequest`.
- `app/collections/page.tsx` — import UI, endpoint index, `matchEndpoint`, `openInBuilder` (writes seed, navigates).
- `components/RequestBuilder.tsx` — consumes the seed on mount (params/headers/json body); single-request export in `handleSave` (`serializeRequestYml`).

Key existing facts the design leans on:
- Zip layout is `<apiId>/v1/<tag>/<request>.yml`; the importer already captures `segments[0]` as `collectionName` — that segment **is** the apiId.
- Single-request export already sets `tags: [apiId]` (RequestBuilder:494). Whole-API export sets `tags: [e.tag]` (the tag, not apiId) — but whole-API collections always arrive as zips, so the directory carries the apiId.
- The builder holds `selectedScopes` state (init `requiredScopes`) and receives available scopes via `scopes` prop; `setSelectedScopes` is the seam for pre-selection.
- Collection-level OAuth2 (`brunoOAuth2`) already stores a space-separated `scope`. Import currently skips `opencollection.yml` entirely.

## Goals / Non-Goals

**Goals:**
- One import → browse and open many requests (A).
- Scopes survive export → import for both whole-API and single-request paths (B).
- Requests resolve to the correct API even when method+path collide across specs (C).
- Unmatched imports tell the user why and what to do (D).

**Non-Goals:**
- Persisting imports across app restarts or writing them to the store (import stays ephemeral by design).
- Round-tripping environments/baseUrl, text/multipart bodies (unchanged; multipart still exported body-less with its warning).
- Compatibility guarantees with arbitrary third-party Bruno collections beyond current best-effort matching.

## Decisions

### A — Session persistence of the imported collection
Persist the *parsed* `ImportedCollection` (name + requests, without recomputed matches) to `sessionStorage` under a dedicated key (e.g. `packrest.collection`). On `CollectionsPage` mount, if `imported` state is empty, rehydrate from that key and recompute `match` against the current endpoint index. Clear/replace it when a new file is imported.

- *Why sessionStorage over a React context/store:* it survives the router unmount that causes the bug, is inherently session-scoped (satisfies "ephemeral across restarts"), and matches the existing `IMPORT_SEED_KEY` pattern — no new global state machinery.
- *Why re-derive matches on rehydrate rather than persist them:* the endpoint index may finish loading after the collection was first parsed; recomputing keeps matches correct and avoids persisting stale API ids.
- *Alternative rejected:* lifting `imported` into a layout-level provider — heavier, and would keep the list alive even when the user wants a clean page.

### B — Scope round-trip
- **Import:** parse `opencollection.yml` (stop skipping it) to read `request.auth.scope`; also read any request-level `http.auth` oauth2 `scope`. Add `scopes?: string[]` to `ImportSeed`. Precedence: request-level → collection-level. In `RequestBuilder`, after resolving the seed, `setSelectedScopes(seed.scopes ∩ Object.keys(scopes))` so only scopes the operation declares are selected.
- **Export (single request):** `serializeRequestYml` currently writes `http.auth = "inherit"`. Extend the `BrunoRequest` model with an optional scope carrier and, in `handleSave`, emit a request-level oauth2 block (via `brunoOAuth2(selectedScopes.join(" "))`) instead of `"inherit"` when scopes are selected. This is additive YAML — importers that don't read it (or real Bruno) ignore the extra scope.
- *Why intersect on import:* prevents seeding invalid scopes when the recipient's spec version differs; also guards against a malformed shared file.
- *Alternative rejected:* a packrest-proprietary field outside the auth block — would not be understood by Bruno itself and breaks the "Bruno-native" premise.

### C — API-scoped matching + disambiguation
Derive a `candidateApiId` per request:
- zip: the top-level directory segment (`segments[0]`), already captured.
- single file: `req.tags?.[0]` when it names a loaded API.

Rework `matchEndpoint(method, url, candidateApiId?)`:
1. If `candidateApiId` is loaded and contains method+path → match there.
2. Else collect all loaded APIs containing method+path.
   - exactly one → match it.
   - more than one and no candidate → return an `ambiguous` marker (the request renders as "ambiguë"/needs selection rather than opening the wrong API).
   - zero → unmatched.
- *Why prefer directory/tags over adding a new export field:* the identifying info already exists in exported artifacts; no format change needed for C.
- *Alternative considered:* always add apiId to request `tags` on whole-API export too — nice-to-have for single-file re-exports, but not required since whole-API exports are zips. Left as an optional export polish.

### D — Unrecognized-import guidance
After building the request list, compute: matched count, and the set of derived `candidateApiId`s. Render a hint banner when matched == 0:
- if a `candidateApiId` is known and not in `listApis()` → "La spec « X » n'est pas chargée — synchronisez-la" with a link to Settings/sync.
- else → generic "aucun endpoint des specs chargées ne correspond".
Reuse the existing `Alert` component already imported on the page.

## Risks / Trade-offs

- **[Rehydrate races the endpoint index]** → recompute matches inside the same effect that depends on `index`; if index is empty, requests simply show unmatched until it loads (existing behavior).
- **[Extra request-level auth block confuses a downstream consumer]** → block is standard Bruno oauth2; keep `autoFetchToken`/placement identical to collection-level so it stays valid Bruno.
- **[candidateApiId from tags is user-editable in Bruno]** → treat it as a hint only; always validate it is a loaded API before scoping, and fall back to global match otherwise.
- **[sessionStorage quota / private mode]** → wrap in try/catch like the existing seed code; on failure, fall back to current single-shot behavior (no regression).

## Migration Plan

Pure additive client change; no data migration. Old exported collections still import (scopes just aren't recovered from them — no worse than today). New behavior is backward compatible. Rollback = revert; nothing persisted needs cleanup beyond a stale sessionStorage key that expires with the session.

## Open Questions

- Ambiguous-match UX (C): silently pick with a warning badge, or require an explicit API chooser? Design leans toward a non-openable "ambiguë" state with a tooltip; a picker is a possible follow-up.
- Should whole-API export also stamp `apiId` into each request's `tags` (belt-and-suspenders for single-file re-exports)? Optional; low cost.

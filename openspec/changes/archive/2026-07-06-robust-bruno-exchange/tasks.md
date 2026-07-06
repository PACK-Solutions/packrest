## 1. Model & parsing (lib/bruno.ts)

- [x] 1.1 Extend `ImportSeed` with `scopes?: string[]`
- [x] 1.2 Add a parser for an opencollection `request.auth` oauth2 block that returns its `scope` (space-separated → string[])
- [x] 1.3 Extend `parseRequestYml` to surface a request-level `http.auth` oauth2 `scope` (leave `"inherit"` handling intact)
- [x] 1.4 Extend the `BrunoRequest` model / `serializeRequestYml` so a request can carry an oauth2 auth block (scopes) instead of `auth: "inherit"`
- [x] 1.5 Add a helper to derive a candidate `apiId` for a request (zip top-dir segment or `tags[0]`), returning it only when non-empty

## 2. Multi-request import persistence — Thread A (app/collections/page.tsx)

- [x] 2.1 Define a session key (e.g. `packrest.collection`) and persist the parsed `ImportedCollection` (name + requests, no matches) on successful import
- [x] 2.2 On mount, when `imported` is empty, rehydrate from the session key and recompute `match` against the endpoint index
- [x] 2.3 Recompute matches when the endpoint `index` finishes loading so a rehydrated list resolves correctly
- [x] 2.4 Clear/replace the session key when a new file is imported; wrap all sessionStorage access in try/catch (fall back to current single-shot behavior)

## 3. Scope round-trip — Thread B

- [x] 3.1 Import: parse `opencollection.yml` (stop skipping it) to read collection-level scopes; capture per-request scopes; store on each `ImportedRequest`
- [x] 3.2 `openInBuilder`: set `seed.scopes` with request-level precedence over collection-level
- [x] 3.3 RequestBuilder seed effect: `setSelectedScopes(seed.scopes ∩ Object.keys(scopes))`; ignore unknown scopes
- [x] 3.4 RequestBuilder `handleSave`: emit a request-level oauth2 block via `brunoOAuth2(selectedScopes.join(" "))` when scopes are selected (else keep `inherit`)

## 4. API-scoped matching — Thread C (app/collections/page.tsx)

- [x] 4.1 Rework `matchEndpoint(method, url, candidateApiId?)`: prefer a match within `candidateApiId` when it is a loaded API
- [x] 4.2 Global fallback: match when exactly one loaded API contains method+path
- [x] 4.3 Return an `ambiguous` result when >1 API contains method+path and no candidate is derivable
- [x] 4.4 Thread `candidateApiId` from the zip directory / single-file tags into every `matchEndpoint` call
- [x] 4.5 Render an "ambiguë" (non-openable) state with a tooltip for ambiguous requests

## 5. Unrecognized-import guidance — Thread D (app/collections/page.tsx)

- [x] 5.1 Compute matched count and the set of derived candidate API ids after building the list
- [x] 5.2 When matched == 0 and a candidate API id is not in `listApis()`, show an `Alert` naming the missing spec with a link to Settings/sync
- [x] 5.3 When matched == 0 and no candidate API is derivable, show a generic "no endpoint matched" `Alert`
- [x] 5.4 Ensure partial-match imports still list all requests with matched ones openable

## 6. Verify

- [x] 6.1 `npm run typecheck` (pass) + `npm run build` static export (pass)
- [x] 6.2 Browser-driven (dev :3001): imported a contract zip, opened a request, navigated back → list persisted with matches intact, both requests still openable (A verified). Scope pre-select (B) covered by the unit harness below rather than visually.
- [x] 6.3 Browser-driven: contract zip → matched request opened `/endpoint?api=contract&op=listContracts` (correct API/op); partial-match list shows matched + "non reconnue" together (C, 5.4). Ambiguous branch (two loaded APIs sharing a path) covered by logic, not staged in-browser.
- [x] 6.4 Browser-driven: imported a `billing` collection (un-synced) → guidance alert named `billing` with a link to Paramètres (D verified).
- [x] 6.5 Unit harness against real `lib/bruno.ts`: `serializeRequestYml` embeds an oauth2 block and `parseRequestYml` recovers scopes; `parseCollectionScopes`/`candidateApiId` verified (11/11 asserts, B round-trip proven).
- [x] 6.6 `openspec validate robust-bruno-exchange --strict` (valid)

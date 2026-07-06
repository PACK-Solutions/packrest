## Why

Bruno collections are packrest's only mechanism for sharing requests between users, yet the round-trip loses information and the import UI quietly reduces a multi-request collection to a single usable request. Four gaps undermine "exchange" as a workflow:

- **A — one request per import.** Opening a request navigates away from `/collections`, unmounting the page and discarding the imported list. Opening a second request from the same collection requires re-importing the file.
- **B — scopes don't round-trip.** Export writes the required OAuth2 scopes into the collection, but import skips all collection scaffolding, so the recipient must re-select scopes by hand — the single most useful thing to share.
- **C — cross-API path collisions.** Matching is `find(method === m && path === p)`, returning the *first* hit. Two loaded specs sharing e.g. `GET /health` open the request against the wrong API.
- **D — "nothing recognized" dead-end.** The endpoint index is built only from already-loaded specs. Importing a valid collection for an un-synced API shows every request as "non reconnue" with no hint that the fix is to sync that spec.

## What Changes

- **Persist the imported collection for the session** so returning to `/collections` restores the list — the user can open many requests from one import. (Thread A)
- **Round-trip OAuth2 scopes.** Import parses collection-level (`opencollection.yml`) and request-level auth to recover scopes; the seed carries them and the builder pre-selects them (intersected with the operation's declared scopes). Single-request export embeds a request-level oauth2 block carrying the selected scopes. (Thread B)
- **Disambiguate matching by API.** Import derives a candidate `apiId` (zip top-level directory segment, or single-file `tags`) and matches within that API first, falling back to a global match; genuinely ambiguous matches are surfaced rather than silently resolved to the first. (Thread C)
- **Guide unrecognized imports.** When no requests match and the derived `apiId` isn't among loaded specs, show a hint pointing the user to sync/select that API's spec; when matches are zero generally, explain why. (Thread D)

No breaking changes to the on-disk Bruno format — the request-level auth block added in B is additive and ignored by importers that don't read it.

## Capabilities

### New Capabilities
- `bruno-collection-exchange`: import and export of Bruno (opencollection 1.0.0) collections and single requests — round-trip fidelity (params, headers, body, scopes), request-to-endpoint matching and disambiguation, multi-request import browsing, and guidance when requests can't be matched.

### Modified Capabilities
<!-- None: no existing specs in openspec/specs/. This is the first spec for this capability. -->

## Impact

- `app/collections/page.tsx` — session persistence of imported collection; API-scoped matching; unrecognized-import hint.
- `lib/bruno.ts` — parse collection/request-level auth scopes; extend `ImportSeed` with `scopes`; helpers for deriving candidate `apiId`.
- `lib/bruno-export.ts` — single-request/whole-API export carries scopes (request-level oauth2 block) so they can round-trip.
- `components/RequestBuilder.tsx` — seed applies scopes (`setSelectedScopes`); single-request export includes selected scopes.
- No new dependencies; no Rust/plugin changes; no changes to `url-policy.ts` paths.

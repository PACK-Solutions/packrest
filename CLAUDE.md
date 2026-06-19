# `packrest/` — Postman-like client for non-developers

A Next.js 16 app that loads the bundled OpenAPI specs from a configurable
source directory and lets business users exercise every endpoint without
leaving the browser. The flow: pick an API → pick an endpoint → form
pre-populated from the contract's `examples` → get a token with selectable
scopes → execute → response panel.

## Sources of truth

| What                                      | Where                                                        |
| ----------------------------------------- | ------------------------------------------------------------ |
| **API shape**, endpoints, scopes, examples | `<specsDir>/<api>/v1/openapi.bundle.yaml`. `specsDir` resolution order: `.packrest.config.json` → `PACKREST_SPECS_DIR` env → `../openapi/dist`. Edit via Settings UI or `npm run sync-specs`. **Or** pull a GitLab release's `bundle.zip` via Settings → "Synchroniser depuis une release GitLab" (`lib/gitlab.ts`); both sources write the same `public/specs/<api>.yaml`. |
| **Spec source config** (server-side)      | `.packrest.config.json` at the repo root (gitignored). Read by both `lib/sync.ts` (Next.js) and `scripts/copy-specs.mjs` (CLI). Holds `specsDir` and the `gitlab` block (`host`, `projectPath`, `token`). |
| **Design tokens** (tones, status colours) | `lib/design.ts` — same palette as `demo/lib/design.ts`       |
| **Persistence** (collections, settings, token) | `lib/storage.ts` — all in `localStorage`, never on disk |

## Layout

- `app/` — App Router.
  - `page.tsx` — API grid.
  - `[api]/page.tsx` — endpoints by tag.
  - `[api]/[operationId]/page.tsx` — server entry that loads the spec and
    hands an `EndpointEntry` to the client `RequestBuilder`.
  - `collections/`, `settings/` — full client pages.
  - `api/token/route.ts` — server-side OAuth2 Client Credentials proxy.
  - `api/proxy/route.ts` — CORS-bypass fetch proxy.
  - `api/config/route.ts` — GET/PUT `.packrest.config.json` (specsDir).
  - `api/sync-specs/route.ts` — POST: copy specs + reset spec cache.
  - `api/gitlab/route.ts` — GET/PUT the `gitlab` config block (token masked
    on GET, kept on PUT when left blank).
  - `api/gitlab/releases/route.ts` — GET: list release tags (+ bundle presence).
  - `api/gitlab/sync/route.ts` — POST `{tag}`: download `bundle.zip`, extract
    specs into `public/specs/`, reset cache.
- `components/` — `RequestBuilder` (state-heavy), plus `Card`, `Field`,
  `Tabs`, `StatusBadge`, `MethodBadge`, `SchemaField`, `JsonEditor`,
  `ResponsePanel`, `ScopeSelector`, `TokenStatus`, `HeaderEditor`.
- `lib/` — `specs.ts` (server-side YAML loader, module cache + `resetSpecCache`),
  `sync.ts` (config loader + copy helper, mirror of `scripts/copy-specs.mjs`),
  `gitlab.ts` (GitLab release download + unzip via `fflate`, writes
  `public/specs/<api>.yaml`; tolerant of nested `<api>/v1/openapi.bundle.yaml`
  and flat `<api>.yaml` zip layouts),
  `types.ts` (OpenAPI 3.1 type surface used by the UI),
  `schema-form` lives in `components/SchemaField.tsx` (recursive renderer),
  `example-extractor.ts`, `postman.ts`, `storage.ts`, `token.ts`, `http.ts`,
  `design.ts`.
- `public/specs/` — populated at predev/prebuild (or via `npm run sync-specs` /
  the Settings UI) by `scripts/copy-specs.mjs` from the configured `specsDir`.

## Before editing

1. **Spec changes win.** If a contract gains a path, scope, or schema, the
   only thing required here is `npm run sync-specs` (or the "Synchroniser
   maintenant" button in Settings) — the new bundle is copied and the
   in-memory cache reset, so pages reload with the updated schema without
   a server restart. If the configured `specsDir` doesn't exist, the script
   warns and exits 0; the UI loads with no APIs visible.
2. **`scripts/copy-specs.mjs` and `lib/sync.ts` are duplicates.** The CLI
   script runs under plain `node` and can't import TS; the route uses the
   TS module. Update both when changing resolution rules or copy logic.
   (The GitLab source in `lib/gitlab.ts` is UI/route-only — not mirrored in
   the CLI, which still copies from the local `specsDir` at predev/prebuild.)
3. **Don't break the server / client boundary.** `specs.ts` is server-only
   (uses `node:fs`). The request builder is `"use client"` and only sees
   serialised props.
4. **Never bypass `/api/token` or `/api/proxy`.** The browser must not
   talk to `api.pack-solutions.com` directly — both for CORS and to keep
   the `client_secret` off the wire.

## Commands

```
npm run dev          # http://localhost:3001 (predev copies specs)
npm run build        # production build (prebuild copies specs)
npm run sync-specs   # re-copy specs without restarting dev (UI button does same)
npm run typecheck    # tsc --noEmit
```

No test runner, ESLint, or Prettier is configured. `typecheck` is the only
automated check — run it before shipping.

## Known limitations

- Only the OAuth2 Client Credentials flow is supported — the contracts
  don't declare anything else.
- Postman v2.1 import maps `{{baseUrl}}` to the single configured base URL;
  multi-environment Postman configs are flattened on import.
- `client_secret` is stored in `localStorage` for convenience. Acceptable
  for an internal tool; a public deployment would need a server-side
  encrypted store and a per-user session.

# `packrest/` — REST client for non-developers (Tauri desktop)

A **Tauri v2 desktop app** wrapping a Next.js 16 frontend. The frontend is a
**static export** (`output: "export"` → `out/`) loaded by the Tauri webview;
there is **no Node server at runtime**. What used to be Next.js API routes now
runs client-side through Tauri plugins (`http`, `fs`, `store`, `dialog`, `opener`).

The flow is unchanged: pick an API → pick an endpoint → form generated from
the contract (fields start empty by design) → get a token with selectable
scopes → execute → response panel. Around that: multipart/form-data bodies
with file upload, HAL `_links` navigation, a JWT token inspector, dark/light
theme, proactive app + spec update notifications, and a guided **Parcours**
(`/parcours`) that chains the whole flow across APIs for a full souscription.

Run it with **`npm run tauri:dev`** (launches `next dev` on :3001 + the webview).
Plain `npm run dev` opens the frontend in a browser but Tauri APIs (store/fs/
http/dialog) are unavailable there — see the fallback note below.

## Sources of truth

| What | Where |
| --- | --- |
| **API shape**, endpoints, scopes, examples | Writable spec store `$APPDATA/specs/<api>.yaml`, read via `lib/specs-fs.ts` (tauri-plugin-fs). Loaded/parsed/dereffed by `lib/specs.ts` (async client loader, module cache + `resetSpecCache`). Populated **only by sync** — GitLab release (primary) or local source dir (fallback); there is no bundled seed, so a fresh install opens to the empty state. |
| **Config** (specsDir, GitLab host/project/token) | `lib/config.ts` → `lib/store.ts` (tauri-plugin-store, file `packrest.json` in app-data). |
| **Persistence** (settings incl. `clientSecret`, token) | `lib/storage.ts` — synchronous API backed by an in-memory cache hydrated from the store; edits persist through `lib/store.ts`. |
| **Design tokens** | `lib/design.ts` |

## Layout

- `src-tauri/` — Rust. `src/lib.rs` registers the 5 plugins and exposes two
  commands: `read_source_specs(dir)` (reads a user-picked local source dir for
  the local sync) and `write_file(path, contents)` (saves Bruno exports to a
  user-chosen path). `tauri.conf.json`: `beforeDevCommand: npm run dev`,
  `devUrl: http://localhost:3001`, `frontendDist: ../out`. Permissions in
  `capabilities/default.json`.
- `app/` — App Router, **all client components** (static export).
  - `page.tsx` — API grid (`?` none) → links to `/api-view?id=<api>`.
  - `api-view/page.tsx` — endpoints by tag; reads `?id=<api>`.
  - `endpoint/page.tsx` — hosts `RequestBuilder`; reads `?api=<api>&op=<operationId>`.
  - `parcours/page.tsx` — guided « Parcours de souscription » wizard: chains ops
    across APIs, embeds `RequestBuilder` per step in simplified mode, captures
    ids/SR ids into a shared context. Reads `?id=<parcours>` (default `souscription`).
  - `collections/`, `settings/`, `help/` — client pages.
  - `layout.tsx` — wraps `TauriProvider` (startup gate) + `AppShell`; the
    `<Suspense>` boundary satisfies static export's `useSearchParams` rule.
  - **No `app/api/*`** — deleted; that logic is client-side now.
- `components/` — `RequestBuilder` (state-heavy; optional `seed` / `onResult` /
  `simplified` props drive the Parcours), `tauri-provider.tsx`
  (hydrate store before render), `app-shell.tsx` (loads the API
  list client-side, refreshes on `SPECS_CHANGED_EVENT`), plus `Card`, `Field`,
  `Tabs`, `MethodBadge`, `SchemaField`, `JsonEditor`, `ResponsePanel`,
  `ScopeSelector`, `TokenStatus`, `HeaderEditor`, `BrunoExportButton`, `SyncDiff`.
  - Request/response: `MultipartBodySection` (multipart/form-data + file
    upload), `FileResponse` (binary/file response viewer + download),
    `JsonView` (collapsible JSON tree), `HalLinks` (follow HAL `_links` across
    APIs), `StatusBadge` (HTTP-status tone badge), `Markdown` (collapsible
    markdown render), `ResponseExportButton` (export a structured response as a
    real `.xlsx` workbook).
  - Token: `TokenInspector` (decode/inspect the JWT).
  - Helpers: `IdCollector` (reuse ids of created resources), `UuidGenerator`
    (UUIDs for form fields), `FieldGenerator` (checksum-valid sample values:
    IBAN/BIC/NIR/SIREN/SIRET) — all topbar tools.
  - Parcours (guided flow, behind `/parcours`): `ParcoursStepper` (collapsible
    phase rail), `ParcoursContextPanel` (shared values chained between steps),
    `ParcoursSelect` (pick item(s) from a list response into the context).
  - Dialogs/theme: `ConfirmDialog` + `PromptDialog` (replace native
    confirm/prompt, unavailable in the webview), `theme-provider` +
    `ThemeToggle` (dark/light via `next-themes`).
  - `components/ui/` holds the shadcn/radix primitives.
- `lib/`
  - `platform.ts` — `isTauri()` runtime detection.
  - `store.ts` — shared tauri-plugin-store handle (localStorage fallback).
  - `storage.ts` — sync settings/token cache + `bootstrapStorage()`.
  - `config.ts` — specsDir + GitLab config in the store.
  - `specs.ts` — async client spec loader; `specs-fs.ts` — Tauri-only fs layer
    for the writable spec store (empty/no-op outside Tauri).
  - `net.ts` — `tauriFetch` (tauri-plugin-http; no CORS) + base64 helpers.
  - `token.ts`, `http.ts` — call the upstream directly (ex-`/api/token`,
    `/api/proxy`); reuse `url-policy.ts` (allowlist + header filter + caps).
  - `sync.ts` — local-dir sync (Rust `read_source_specs` → `specs-fs`);
    `sync-constants.json` holds the shared constants (`PACKREST_SPECS_DIR`
    env var, config filename, default relative path).
  - `gitlab.ts` — GitLab release download (tauriFetch) + `fflate` unzip → `specs-fs`.
  - `update-check.ts` — unified "is something newer?" across both update
    channels (app via GitHub, specs via GitLab); pure logic behind the startup
    notifier + Settings "Mises à jour" card.
  - `id-collector.ts` — records `id` from 2xx POST response bodies for reuse
    across APIs; sync cache like `storage.ts`, keeps the 3 most-recent per API.
  - `bruno.ts` / `bruno-export.ts` — Bruno collection (pure JS, unchanged).
  - `dialog.ts` (folder/save pickers), `exporter.ts` (save via `write_file`).
  - `github.ts` (GitHub Releases update check), `app-version.ts` (running app
    version), `opener.ts` (open URL in OS browser), `status-help.ts` (HTTP
    status explanations for ResponsePanel + `/help`).
  - `xlsx.ts` — dependency-free client-side `.xlsx` workbook builder (flattens
    a JSON response to rows) behind `ResponseExportButton`.
  - `parcours.ts` — declarative « souscription » parcours (ordered steps, seed↔
    context mapping, response capture, sessionStorage progress) behind
    `/parcours`; `fake-fields.ts` — checksum-valid sample values
    (IBAN/BIC/NIR/SIREN/SIRET) for `FieldGenerator`.
  - `deref.ts`, `spec-diff.ts` (single runtime diff, no build-time consumer),
    `example-extractor.ts`, `env.ts`, `types.ts`, `hal.ts`, `jwt.ts`,
    `design.ts`, `utils.ts`.

## Before editing

1. **Spec changes win.** Specs come only from sync: a GitLab release
   (`lib/gitlab.ts`, primary) or the local `specsDir` (`lib/sync.ts`, fallback).
   Either writes into `$APPDATA/specs` and calls `resetSpecCache()`, which fires
   `SPECS_CHANGED_EVENT` so pages reload. There is no bundled seed — a fresh
   install opens to the empty state until the first sync.
2. **The spec diff has one runtime implementation** in `lib/spec-diff.ts`
   (`diffSpec`), consumed by `lib/sync.ts` and `lib/gitlab.ts`. No build-time
   mirror exists anymore.
3. **Tauri vs browser.** Every Tauri plugin call is guarded by `isTauri()` with
   a graceful fallback (localStorage for the store). The spec store is
   Tauri-only, so outside Tauri the API list is empty. Keep imports of
   `@tauri-apps/*` behind dynamic `import()` inside functions so the static
   export still prerenders.
4. **Keep `url-policy.ts` on the token/proxy paths.** `checkUrl` (allowlist +
   private-IP block) and the header safelist still guard `lib/token.ts` /
   `lib/http.ts`. The Tauri HTTP capability scope in
   `src-tauri/capabilities/default.json` is the other gate — a **custom GitLab
   host or release-asset storage host** may need adding there.
5. **Storage stays synchronous.** `loadSettings/saveSettings/loadToken/saveToken`
   are sync (backed by the cache). Do not make them async — the cache is
   hydrated by `TauriProvider` before any page renders.

## Commands

```
npm run tauri:dev    # full desktop app (next dev :3001 + webview)  ← primary
npm run dev          # frontend only in a browser (Tauri APIs disabled; no specs)
npm run build        # static export → out/
npm run tauri:build  # bundle the desktop app
npm run typecheck    # tsc --noEmit
npm run test:unit    # vitest run (unit tests)
```

No ESLint/Prettier. Unit tests run under Vitest (`npm run test:unit`) — the
spec-normalization logic in `lib/schema-normalize.ts` is covered there.
`typecheck` + `next build` (static export) + `cargo check` (in `src-tauri/`) +
`npm run test:unit` are the automated checks — run before shipping.

## Known limitations

- Only the OAuth2 Client Credentials flow is supported.
- Requests are **not persisted**. Exchange is via Bruno collections: export a
  whole API or the current request (client-side, saved via a native dialog);
  import a Bruno `.zip`/`.yml` on `/collections`. Import supports the
  `opencollection` YAML format only. Imported requests match a spec endpoint by
  method + path and open via a one-shot `sessionStorage` seed (`IMPORT_SEED_KEY`).
- The per-environment `clientSecret`s (one per env — dev/rec/custom), token and
  the GitLab PAT live in the app-data store (`packrest.json`), unencrypted —
  same protection level as the previous localStorage / gitignored file. A
  hardened build would move secrets to the OS keychain.

# `packrest/` — REST client for non-developers (Tauri desktop)

A **Tauri v2 desktop app** wrapping a Next.js 16 frontend. The frontend is a
**static export** (`output: "export"` → `out/`) loaded by the Tauri webview;
there is **no Node server at runtime**. What used to be Next.js API routes now
runs client-side through Tauri plugins (`http`, `fs`, `store`, `dialog`).

The flow is unchanged: pick an API → pick an endpoint → form pre-populated from
the contract's `examples` → get a token with selectable scopes → execute →
response panel.

Run it with **`npm run tauri:dev`** (launches `next dev` on :3001 + the webview).
Plain `npm run dev` opens the frontend in a browser but Tauri APIs (store/fs/
http/dialog) are unavailable there — see the fallback note below.

## Sources of truth

| What | Where |
| --- | --- |
| **API shape**, endpoints, scopes, examples | Writable spec store `$APPDATA/specs/<api>.yaml`, read via `lib/specs-fs.ts` (tauri-plugin-fs). Loaded/parsed/dereffed by `lib/specs.ts` (async client loader, module cache + `resetSpecCache`). |
| **Bundled seed specs** | `public/specs/<api>.yaml` + `public/specs/manifest.json`, produced by `scripts/copy-specs.mjs` at predev/prebuild from the local `specsDir`. Shipped in the static export; `seedSpecsIfEmpty()` (in `specs-fs.ts`) copies them into `$APPDATA/specs` on first launch. |
| **Config** (specsDir, GitLab host/project/token) | `lib/config.ts` → `lib/store.ts` (tauri-plugin-store, file `packrest.json` in app-data). |
| **Persistence** (settings incl. `clientSecret`, token) | `lib/storage.ts` — synchronous API backed by an in-memory cache hydrated from the store; edits persist through `lib/store.ts`. |
| **Design tokens** | `lib/design.ts` |

## Layout

- `src-tauri/` — Rust. `src/lib.rs` registers the 4 plugins and exposes two
  commands: `read_source_specs(dir)` (reads a user-picked local source dir for
  the local sync) and `write_file(path, contents)` (saves Bruno exports to a
  user-chosen path). `tauri.conf.json`: `beforeDevCommand: npm run dev`,
  `devUrl: http://localhost:3001`, `frontendDist: ../out`. Permissions in
  `capabilities/default.json`.
- `app/` — App Router, **all client components** (static export).
  - `page.tsx` — API grid (`?` none) → links to `/api-view?id=<api>`.
  - `api-view/page.tsx` — endpoints by tag; reads `?id=<api>`.
  - `endpoint/page.tsx` — hosts `RequestBuilder`; reads `?api=<api>&op=<operationId>`.
  - `collections/`, `settings/` — client pages.
  - `layout.tsx` — wraps `TauriProvider` (startup gate) + `AppShell`; the
    `<Suspense>` boundary satisfies static export's `useSearchParams` rule.
  - **No `app/api/*`** — deleted; that logic is client-side now.
- `components/` — `RequestBuilder` (state-heavy), `tauri-provider.tsx`
  (hydrate store + seed specs before render), `app-shell.tsx` (loads the API
  list client-side, refreshes on `SPECS_CHANGED_EVENT`), plus `Card`, `Field`,
  `Tabs`, `MethodBadge`, `SchemaField`, `JsonEditor`, `ResponsePanel`,
  `ScopeSelector`, `TokenStatus`, `HeaderEditor`, `BrunoExportButton`, `SyncDiff`.
- `lib/`
  - `platform.ts` — `isTauri()` runtime detection.
  - `store.ts` — shared tauri-plugin-store handle (localStorage fallback).
  - `storage.ts` — sync settings/token cache + `bootstrapStorage()`.
  - `config.ts` — specsDir + GitLab config in the store.
  - `specs.ts` — async client spec loader; `specs-fs.ts` — fs/seed layer.
  - `net.ts` — `tauriFetch` (tauri-plugin-http; no CORS) + base64 helpers.
  - `token.ts`, `http.ts` — call the upstream directly (ex-`/api/token`,
    `/api/proxy`); reuse `url-policy.ts` (allowlist + header filter + caps).
  - `sync.ts` — local-dir sync (Rust `read_source_specs` → `specs-fs`).
  - `gitlab.ts` — GitLab release download (tauriFetch) + `fflate` unzip → `specs-fs`.
  - `bruno.ts` / `bruno-export.ts` — Bruno collection (pure JS, unchanged).
  - `dialog.ts` (folder/save pickers), `exporter.ts` (save via `write_file`).
  - `deref.ts`, `spec-diff.ts`, `example-extractor.ts`, `env.ts`, `types.ts`,
    `hal.ts`, `jwt.ts`, `design.ts`, `utils.ts`.
- `public/specs/` — bundled seed specs + `manifest.json` (generated; gitignored).

## Before editing

1. **Spec changes win.** New bundle in the local `specsDir` → local sync
   (topbar button or Settings) copies it into `$APPDATA/specs` and calls
   `resetSpecCache()`, which fires `SPECS_CHANGED_EVENT` so pages reload. The
   bundled seed only refreshes at predev/prebuild via `copy-specs.mjs`.
2. **`copy-specs.mjs` still mirrors the sync/diff logic.** It runs under plain
   `node` (can't import TS) and, besides copying, emits `public/specs/manifest.json`
   and prints a spec diff. Its diff is a JS mirror of `lib/spec-diff.ts` — keep
   the two in step. (Runtime sync now lives in `lib/sync.ts` / `lib/gitlab.ts`,
   not a server route.)
3. **Tauri vs browser.** Every Tauri plugin call is guarded by `isTauri()` with
   a graceful fallback (localStorage for the store; bundled static `/specs/`
   for reads). Keep imports of `@tauri-apps/*` behind dynamic `import()` inside
   functions so the static export still prerenders.
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
npm run dev          # frontend only in a browser (Tauri APIs disabled)
npm run build        # static export → out/ (prebuild copies specs + manifest)
npm run tauri:build  # bundle the desktop app
npm run sync-specs   # refresh bundled seed specs + manifest from specsDir
npm run typecheck    # tsc --noEmit
```

No test runner/ESLint/Prettier. `typecheck` + `next build` (static export) +
`cargo check` (in `src-tauri/`) are the automated checks — run before shipping.

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

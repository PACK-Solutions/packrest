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
    phase rail), `ParcoursModePanel` (manuel / semi-auto / auto + the auto run's
    controls and the checklist of optional steps to execute),
    `ParcoursContextPanel` (shared values chained between steps),
    `ParcoursSelect` (pick item(s) from a list response into the context),
    `ParcoursDocuments` (Phase C: requirements-driven upload+attach per SR),
    `ParcoursDecisions` (Phase D: quick APPROVED/REJECTED over the SRs of the
    current run — replaces the old lister → consulter → décider steps).
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
  - `json-path.ts` — leaf-path addressing (`parsePath`/`getAtPath`/`setAtPath`/
    `flattenLeaves`/`deepMerge`). An array index is **only ever bracket
    notation** (`funds[0]`, `[-1]` = last); a dotted segment is always an object
    key, even a numeric one — otherwise `formatPath` wouldn't be invertible and a
    map keyed `"1"` would rebuild as a list. Because a key containing a `.` still
    can't survive a string path, do NOT flatten-then-rebuild arbitrary user input:
    walk it structurally (`pruneSeededLeaves` in `parcours.ts`). Shared by seed
    mappings, the RequestBuilder's seed merge and response capture.
  - `schema-sample.ts` — **synthesizes a request body FROM the contract**:
    `sampleFromSchema` walks a dereferenced request schema (required-only by
    default, `readOnly` skipped, enums/consts/formats/bounds/`minItems` honoured),
    normalising with the same `schema-normalize` helpers `SchemaField` uses, so the
    form and the generator can't drift apart. Plus `schemaAtPath`,
    `coerceToSchema`, and `validateAgainstSchema` (the drift detector — type,
    enum, required, unknown/readOnly property, plus `pattern` and length bounds so
    a value the generator itself couldn't satisfy is reported instead of 422-ing
    silently). Domain-free and unit-tested without a spec.
  - `parcours-hints.ts` — the domain values that fill the generated bodies
    (identity, address, IBAN/BIC, TIN, amounts, `fund_id`, context ids), matched by
    path > name > format. A hint returning `SAMPLE_SKIP` leaves the property out —
    a required id the context can't supply must stay ABSENT, never a placeholder
    pointing at nothing.
  - `parcours.ts` — declarative « souscription » parcours (ordered steps, seed↔
    context mapping, response capture, sessionStorage progress) behind
    `/parcours`; `fake-fields.ts` — checksum-valid sample values
    (IBAN/BIC/NIR/SIREN/SIRET) for `FieldGenerator`.
    A `SeedMapping.name` and a `ProducerSpec.bodyField` entry are **paths**, so a
    nested contract property is reachable both ways: the beneficiary clause is an
    object, seeded as `beneficiary_clause.content` +
    `beneficiary_clause.date_of_effect` (two context keys, its date strictly
    future) and read back from `beneficiary_clauses[-1].content`.
    A step draft stores the seed it was filled from (`StepDraft.seeded`, written
    by `seedSnapshot`, keyed by path), so `draftWithoutSeededFields` can refresh an
    untouched pre-fill from the live context while keeping whatever the user typed
    over — per leaf, so one edited leaf of an object doesn't pin its siblings.
  - `parcours-auto.ts` — the semi/auto runner. A step's body is
    `deepMerge(sampleFromSchema(…), seed, AUTO_PLAN override)`: the CONTRACT first,
    then the context ids, then the overrides. `AUTO_PLAN` therefore holds only what
    a schema cannot express — which enum member this flow files, rates that must
    total 100%, `omit` for a field left to the server's default, a path param no
    step captures. `loadStepBodySchema` resolves the schema (injectable, so
    `buildAutoRequest` stays synchronous and testable) and `autoRequestIssues`
    reports anything that no longer fits, surfaced in the mode panel.
    Also `runParcoursAuto` (frontier → documents step, pauses at the product
    picker) and the optional-step opt-in (`optionalAutoSteps` +
    `ParcoursState.autoOptional`). It never replays a done step: ticking one in the
    mode panel un-completes it, which is what lets a relaunch reach it.
  - `parcours-documents.ts` / `parcours-decisions.ts` — pure (React-free)
    analysis behind the two custom parcours steps: a SR's `requirements[]` for
    the Phase C uploads, and the SR reading + `decisions` payload building for
    the Phase D quick decision.
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
6. **Never hard-code a request body.** Both body generators read the synced
   contract: the request tester's form from `components/SchemaField.tsx`, the
   parcours' auto/semi bodies from `lib/schema-sample.ts` + `lib/parcours-hints.ts`.
   A field a spec renamed or reshaped must be followed automatically — v0.0.79 made
   `beneficiary_clause` an object and the old hand-typed `AUTO_PLAN` literals kept
   posting a string, 422-ing every contract step. So: a new value goes in the hint
   registry (or a seed mapping for a context value), and `AUTO_PLAN` gets an entry
   ONLY for what a schema genuinely cannot state. Any drift left over is reported
   by `validateAgainstSchema` in the auto-run log rather than staying silent.
   Specs live outside the repo, so no CI check can see them — that runtime report
   is the guardrail.

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
spec-normalization logic in `lib/schema-normalize.ts`, the body generator
(`lib/schema-sample.ts`) and the path utilities (`lib/json-path.ts`) are covered
there.
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

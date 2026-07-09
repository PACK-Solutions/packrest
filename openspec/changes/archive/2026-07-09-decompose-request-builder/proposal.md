## Why

`components/RequestBuilder.tsx` (1054 lines; the component function alone spans 744 lines, L98–842; cognitive complexity 26) is the app's only flagged complexity hotspot. A single component scope holds ~17 `useState` slices plus refs and effects, and absorbs eight distinct concerns: token lifecycle, request execution, HAL `_links` navigation, Bruno export, curl generation, context-path save, keyboard shortcuts, and sub-render helpers.

The `runRef`/`escRef` indirection (L421–439) is the tell: it is a stale-closure workaround that exists only because `handleRun`/`onKey` are recreated on every render inside an oversized component, so the keyboard-shortcut effect can't depend on them directly. High complexity here raises the cost and risk of every future edit to the core request flow.

## What Changes

A behavior-preserving refactor in two phases:

- **Phase 1 — pure-function lift (mechanical, zero behavior change).** Move the already-module-scope pure helpers out of `RequestBuilder.tsx`:
  - → `lib/curl.ts`: `buildCurl`, `curlForm`, `escapeSingleQuotes`, `managedContentType`, `maskToken`
  - → `lib/multipart.ts`: `buildMultipart`, `formatUploadSize`
- **Phase 2 — custom-hook extraction (behavioral, after Phase 1).** Extract three hooks that each own a cohesive state cluster and return stable callbacks:
  - `useToken(...)` ← `token`, `tokenError`, `fetchingToken`, `selectedScopes`, `handleGetToken`, `buildLiveHeaders`
  - `useRequestExecution(...)` ← `response`, `error`, `running`, `uploading`, `handleRun`
  - `useHalNavigation(...)` ← `followStack`, `handleFollowLink`, `handleNavBack`, `handleNavJumpTo`, `handleNavToOperation`
  - **Remove `runRef`/`escRef`**: the keyboard effect depends directly on the stable callbacks the hooks return, eliminating the indirection.

No user-facing behavior changes. No new dependencies. No Rust/plugin/spec-file changes.

## Capabilities

### New Capabilities
- `request-builder`: the observable request-building contract (token acquisition, request execution, HAL navigation, curl copy, Bruno export). Captured now as regression guards so the refactor is provably behavior-preserving.

## Impact

- `components/RequestBuilder.tsx` — shrinks to orchestration + JSX; the component function drops well below the complexity threshold (measured 18→9; all functions ≤12).
- New: `lib/curl.ts`, `lib/multipart.ts`; new hook files `hooks/use-token.ts`, `hooks/use-request-execution.ts`, `hooks/use-hal-navigation.ts`, and `hooks/use-request-actions.ts` (Bruno export / curl / context-path — added in the complexity-driven pass, see design Resolution). `lib/curl.ts` also gains `buildManagedHeaders`; `RequestBuilder.tsx` gains a `RequestBodyTab` sub-component.
- Consumers of the moved exports update their imports (`buildCurl` is already `export`ed; the rest become newly exported from `lib/`).
- No changes to `lib/token.ts` / `lib/http.ts` / `lib/url-policy.ts` behavior — the security paths are untouched.

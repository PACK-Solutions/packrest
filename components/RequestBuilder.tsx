"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, KeyRound, Loader2, Play, Save, Terminal } from "lucide-react";

import { Card, CardHeader, CardBody } from "@/components/Card";
import Tabs from "@/components/Tabs";
import MethodBadge from "@/components/MethodBadge";
import Field, { ConstraintBadges } from "@/components/Field";
import SchemaField from "@/components/SchemaField";
import JsonEditor from "@/components/JsonEditor";
import MultipartBodySection from "@/components/MultipartBodySection";
import ResponsePanel from "@/components/ResponsePanel";
import ScopeSelector from "@/components/ScopeSelector";
import TokenStatus from "@/components/TokenStatus";
import TokenInspector from "@/components/TokenInspector";
import HeaderEditor from "@/components/HeaderEditor";
import Markdown from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loadSettings,
  customEnvById,
  SETTINGS_CHANGED_EVENT,
  type SavedHeader,
} from "@/lib/storage";
import { IMPORT_SEED_KEY, type ImportSeed } from "@/lib/bruno";
import type { ProxyResponse } from "@/lib/http";
import { clearToken } from "@/lib/token";
import { resolveBaseUrl } from "@/lib/env";
import type {
  OpenApiOperation,
  OpenApiParameter,
  JsonSchema,
} from "@/lib/types";
import { buildManagedHeaders } from "@/lib/curl";
import { formatUploadSize } from "@/lib/multipart";
import { bodyHasEditableFields } from "@/lib/schema-normalize";
import { useToken } from "@/hooks/use-token";
import { useRequestExecution } from "@/hooks/use-request-execution";
import { useHalNavigation } from "@/hooks/use-hal-navigation";
import { useRequestActions } from "@/hooks/use-request-actions";

// Static per-session; read once at module scope (guarded for prerender).
const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

// Narrow an unknown JSON value to a plain object, so a partial seed body can be
// shallow-merged into the current body without wiping fields the user filled.
function asObjectRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

interface Props {
  apiId: string;
  apiTitle: string;
  method: string;
  path: string;
  operationId: string;
  operation: OpenApiOperation;
  pathParameters: OpenApiParameter[];
  defaultBaseUrl: string;
  scopes: Record<string, string>;
  tokenUrl: string;
  /** In-memory seed (Parcours) — preferred over the sessionStorage IMPORT_SEED_KEY. */
  seed?: ImportSeed;
  /** Called once with the operation's response after each execution (Parcours capture). */
  onResult?: (res: ProxyResponse) => void;
  /** Parcours mode: auto-fetch the token and hide technical chrome (URL,
   *  auth card, headers, export/curl). */
  simplified?: boolean;
  /** Parcours: initial form draft to restore (params + body the user last left
   *  on this step) so returning to it doesn't wipe typed values. Context-mapped
   *  fields are still re-applied on top via `seed`, so corrections propagate. */
  initialDraft?: { params?: Record<string, string>; body?: unknown };
  /** Parcours: called on unmount with the current form snapshot so the host can
   *  persist it per step. */
  onDraftChange?: (draft: { params: Record<string, string>; body: unknown }) => void;
  /** Parcours picker steps: cap the response panel to the form column's height
   *  (instead of the viewport) so a selection list rendered below the builder
   *  sits right under the « Exécuter » button rather than far down the page. */
  compactResponse?: boolean;
}

// Single full-feature request builder. State sources of truth:
//   • settings (baseUrl, tokenUrl, clientId, clientSecret) — localStorage
//   • path/query/header values — local React state
//   • body — local React state (root of the schema), edited via SchemaField
//   • token — localStorage, refreshed via /api/token
//   • response — local React state
export default function RequestBuilder(props: Props) {
  const {
    apiId,
    apiTitle,
    method,
    path,
    operationId,
    operation,
    pathParameters,
    defaultBaseUrl,
    scopes,
    tokenUrl,
    seed,
    onResult,
    simplified,
    initialDraft,
    onDraftChange,
    compactResponse,
  } = props;

  const allParams = useMemo<OpenApiParameter[]>(
    () => [...pathParameters, ...(operation.parameters ?? [])],
    [pathParameters, operation.parameters],
  );
  const pathParams = allParams.filter((p) => p.in === "path");
  const queryParams = allParams.filter((p) => p.in === "query");

  const [baseUrl, setBaseUrl] = useState(() =>
    resolveBaseUrl(apiId, "dev", "", defaultBaseUrl),
  );
  // Per-API placeholder mirroring the resolved default (e.g. webhook/person get
  // their `/webhooks`, `/person` prefix), shown only when the field is emptied.
  const baseUrlPlaceholder = resolveBaseUrl(apiId, "dev", "", defaultBaseUrl);
  // Current environment, kept in state so the "save context path" button knows
  // whether it applies (presets only). Re-synced from settings at mount and
  // whenever settings change (this tab via SETTINGS_CHANGED_EVENT, other tabs
  // via storage) so saving a context path updates the URL field instantly.
  const [environment, setEnvironment] =
    useState<ReturnType<typeof loadSettings>["environment"]>("dev");
  useEffect(() => {
    const sync = () => {
      const s = loadSettings();
      setEnvironment(s.environment);
      setBaseUrl(
        resolveBaseUrl(
          apiId,
          s.environment,
          customEnvById(s, s.environment)?.baseUrl ?? "",
          defaultBaseUrl,
          s.apiPaths,
        ),
      );
    };
    sync();
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [apiId, defaultBaseUrl]);

  // Parameter and body fields start empty — no contract examples are
  // pre-filled, so the user always types the exact values they intend to send.
  const [paramValues, setParamValues] = useState<Record<string, string>>(
    () => {
      const init: Record<string, string> = {};
      for (const p of allParams) init[p.name] = "";
      // Restore a Parcours draft (values typed before the user left this step).
      if (initialDraft?.params) Object.assign(init, initialDraft.params);
      return init;
    },
  );
  useEffect(() => {
    setParamValues((prev) => {
      const next = { ...prev };
      for (const p of allParams) {
        if (next[p.name] === undefined) next[p.name] = "";
      }
      return next;
    });
  }, [allParams]);

  const bodySchema: JsonSchema | undefined =
    operation.requestBody?.content?.["application/json"]?.schema;
  const [bodyValue, setBodyValue] = useState<unknown>(
    () => initialDraft?.body ?? null,
  );

  // multipart/form-data endpoints (file upload). When there's no JSON body but
  // a multipart one, the "Corps" tab renders a file picker + metadata form and
  // the request is sent as a real multipart body (rebuilt in /api/proxy).
  const multipartMedia = operation.requestBody?.content?.["multipart/form-data"];
  const multipartSchema: JsonSchema | undefined = multipartMedia?.schema;
  const isMultipart = !bodySchema && !!multipartSchema;
  const [files, setFiles] = useState<Record<string, File | null>>({});

  const [customHeaders, setCustomHeaders] = useState<SavedHeader[]>([]);

  const requiredScopes = useMemo(
    () => (operation.security ?? []).flatMap((e) => Object.values(e).flat()),
    [operation],
  );
  // Scopes actually requested when minting a token. When the operation declares
  // none of its own (it relies on the document-level `security`), fall back to
  // every scope the flow exposes — otherwise simplified-mode auto-fetch would
  // mint a scope-less token the API rejects, with no selector to correct it.
  const tokenScopes = useMemo(
    () => (requiredScopes.length ? requiredScopes : Object.keys(scopes)),
    [requiredScopes, scopes],
  );

  // Token lifecycle (bearer, in-flight/error UX, selected scopes) + the live
  // header assembly shared by run / follow / curl.
  const {
    token,
    setToken,
    tokenError,
    fetchingToken,
    selectedScopes,
    setSelectedScopes,
    getToken,
    buildLiveHeaders,
  } = useToken({ tokenUrl, initialScopes: tokenScopes });

  // Simplified (Parcours) mode: mint the token automatically so the user never
  // presses « Obtenir un token ». Throttled so a short-lived (or clock-skewed)
  // token that arrives already (near-)expired can't spin the token endpoint in a
  // refetch loop, and a prior `tokenError` pauses the auto-retry — the inline
  // error offers a manual « Réessayer ».
  const lastAutoFetchRef = useRef(0);
  useEffect(() => {
    if (!simplified || fetchingToken || tokenError) return;
    const now = Date.now();
    const expired = !token || token.expiresAt <= now + 5000;
    if (!expired) return;
    if (now - lastAutoFetchRef.current < 30000) return;
    lastAutoFetchRef.current = now;
    void getToken({ silent: true });
  }, [simplified, token, fetchingToken, tokenError, getToken]);

  const composedUrl = useMemo(() => {
    // Keep the {name} placeholder for an unfilled path param rather than
    // dropping it — an empty substitution would leave a stray "//" and hide
    // the fact that the segment is still missing.
    const filledPath = path.replace(/\{([^}]+)\}/g, (_, name) => {
      const v = paramValues[name] ?? "";
      return v === "" ? `{${name}}` : encodeURIComponent(v);
    });
    const qs = queryParams
      .filter((p) => (paramValues[p.name] ?? "") !== "")
      .map(
        (p) =>
          `${encodeURIComponent(p.name)}=${encodeURIComponent(paramValues[p.name])}`,
      )
      .join("&");
    return `${baseUrl}${filledPath}${qs ? `?${qs}` : ""}`;
  }, [baseUrl, path, queryParams, paramValues]);

  // Request execution + the whole result-view state machine (response, error,
  // running, uploading, and the HAL followStack). run() is referentially
  // stable, so the keyboard shortcut can depend on it directly.
  const {
    response,
    error,
    running,
    uploading,
    followStack,
    isFollowing,
    currentResponse,
    effective,
    run,
    setFollowStack,
    setRunning,
    setError,
  } = useRequestExecution({
    method,
    composedUrl,
    isMultipart,
    bodySchema,
    bodyValue,
    files,
    customHeaders,
    buildLiveHeaders,
    apiId,
    operationId,
    operation,
    path,
  });

  // HAL `_links` navigation — drives the followStack owned above.
  const { followLink, navBack, navJumpTo, navToOperation } = useHalNavigation({
    buildLiveHeaders,
    customHeaders,
    setFollowStack,
    setRunning,
    setError,
  });

  // Seed application. A Parcours passes an in-memory `seed` prop and re-applies
  // it whenever the upstream context changes (a corrected context value must
  // reach the already-open form — the component is keyed only by step id, so it
  // does not remount on an edit); the /collections importer instead writes to
  // sessionStorage and is applied once on mount. Keyed on the seed's content so
  // a correction re-seeds, and the body is shallow-merged so fields the user
  // has since filled are never wiped.
  const seedSignature = seed ? JSON.stringify(seed) : "";
  // Values we last wrote from the seed, per field — so a re-seed (triggered by a
  // context edit) only overwrites a field the user hasn't since changed (still
  // blank, or still equal to what we seeded), never a value they retyped.
  const seededRef = useRef<{
    params: Record<string, string>;
    body: Record<string, unknown>;
  }>({ params: {}, body: {} });
  useEffect(() => {
    let incoming: ImportSeed | null = seed ?? null;
    if (!incoming) {
      let raw: string | null = null;
      try {
        raw = window.sessionStorage.getItem(IMPORT_SEED_KEY);
      } catch {
        return;
      }
      if (!raw) return;
      window.sessionStorage.removeItem(IMPORT_SEED_KEY);
      try {
        incoming = JSON.parse(raw) as ImportSeed;
      } catch {
        return;
      }
    }
    const s = incoming;
    if (s.apiId !== apiId || s.operationId !== operationId) return;
    if (s.params) {
      const sp = s.params;
      setParamValues((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(sp)) {
          const cur = prev[k];
          const lastSeeded = seededRef.current.params[k];
          if (cur === undefined || cur === "" || cur === lastSeeded) next[k] = v;
          seededRef.current.params[k] = v;
        }
        return next;
      });
    }
    if (s.headers) setCustomHeaders(s.headers);
    if (s.body !== undefined) {
      const seedBody = s.body;
      setBodyValue((prev: unknown) => {
        const p = asObjectRecord(prev);
        const b = asObjectRecord(seedBody);
        if (!p || !b) {
          // Non-object seed/body: adopt the seed only when nothing is entered.
          if (p == null) {
            seededRef.current.body = {};
            return seedBody;
          }
          return prev;
        }
        const next = { ...p };
        for (const [k, v] of Object.entries(b)) {
          const cur = p[k];
          const lastSeeded = seededRef.current.body[k];
          if (cur === undefined || cur === "" || cur === null || cur === lastSeeded)
            next[k] = v;
          seededRef.current.body[k] = v;
        }
        return next;
      });
    }
    // Pre-select imported scopes, limited to those this operation declares so
    // a stale/foreign scope can't be selected.
    if (s.scopes?.length) {
      const allowed = new Set(Object.keys(scopes));
      const applied = s.scopes.filter((sc) => allowed.has(sc));
      if (applied.length) setSelectedScopes(applied);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedSignature]);

  // Report the operation's response to a Parcours host once per execution.
  // `response` is a fresh object each run, so ref-guarding fires onResult
  // exactly once per new result (not on unrelated re-renders).
  const lastReportedRef = useRef<ProxyResponse | null>(null);
  useEffect(() => {
    if (response && response !== lastReportedRef.current) {
      lastReportedRef.current = response;
      onResult?.(response);
    }
  }, [response, onResult]);

  // Persist the form draft (params + body) for a Parcours step on unmount, so
  // returning to it — after correcting an earlier step — restores what was
  // typed instead of an empty form. Files are not serialisable and are skipped
  // (the user re-picks them). A ref holds the latest snapshot; `onDraftChange`
  // is read through a ref so the unmount-only effect never re-subscribes.
  const draftSnapshotRef = useRef<{ params: Record<string, string>; body: unknown }>({
    params: {},
    body: null,
  });
  draftSnapshotRef.current = { params: paramValues, body: bodyValue };
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  useEffect(() => {
    return () => onDraftChangeRef.current?.(draftSnapshotRef.current);
  }, []);

  // Keyboard shortcuts: ⌘/Ctrl+Entrée exécute, Échap ferme la navigation HAL.
  // `run` / `navToOperation` are referentially stable (the hooks return stable
  // callbacks), so the listener re-subscribes only on the rare empty↔non-empty
  // stack flip — no ref indirection needed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Radix (Select/Dialog/Sheet) claims Escape first — don't fight it.
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void run();
      } else if (e.key === "Escape") {
        if (isFollowing) navToOperation();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, navToOperation, isFollowing]);

  // "Describe the current request" actions (Bruno export, curl copy, context-
  // path save) — mid-navigation these track the visible request (a GET on the
  // followed URL) via `effective`, not the original operation.
  const { exportBruno, copyCurl, saveContextPath } = useRequestActions({
    apiId,
    operation,
    pathParams,
    queryParams,
    paramValues,
    customHeaders,
    bodySchema,
    bodyValue,
    files,
    isMultipart,
    isFollowing,
    selectedScopes,
    effective,
    baseUrl,
    buildLiveHeaders,
  });

  // The "Corps" tab renders a JSON body form, a multipart upload form, or
  // nothing (GET / no request body).
  // Hide the "Corps" tab when the JSON body has nothing to fill (every
  // field readOnly, e.g. the French-residency upsert whose only field is a
  // server-managed const). Multipart bodies always keep the tab.
  const hasBody =
    (!!bodySchema && bodyHasEditableFields(bodySchema)) || isMultipart;

  // Greyed-out managed rows shown in the header editor: the (masked) bearer
  // and the Content-Type the proxy will set for the body.
  const managedHeaders = buildManagedHeaders(
    token?.accessToken,
    !!bodySchema,
    isMultipart,
  );

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={method} size="md" />
          <code className="text-foreground text-sm font-medium">{path}</code>
          <span className="text-muted-foreground ml-2 text-xs">
            {operationId}
          </span>
          <TokenStatus
            token={token}
            onCleared={() => {
              clearToken();
              setToken(null);
            }}
          />
        </div>
        {operation.summary && (
          <p className="text-muted-foreground text-sm">{operation.summary}</p>
        )}
        {operation.description && (
          <Markdown
            content={operation.description}
            className="text-muted-foreground max-w-3xl pt-1"
            collapsible
          />
        )}
      </header>

      {/* Stacked below xl; at xl the form and the response sit side-by-side
          (header above spans both columns so the response panel aligns with
          the first card), the response column sticky + independently
          scrollable so it stays at eye level while the form scrolls. */}
      <div className="space-y-4 @min-[61rem]:grid @min-[61rem]:grid-cols-2 @min-[61rem]:items-start @min-[61rem]:gap-6 @min-[61rem]:space-y-0">
        <div className="min-w-0 space-y-4">
      {!simplified && (
      <Card>
        <CardHeader>
          <span className="font-semibold">URL composée</span>
        </CardHeader>
        <CardBody className="space-y-2 p-3">
          <div className="flex items-center gap-1.5">
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={baseUrlPlaceholder}
              className="h-8 font-mono text-xs"
            />
            {environment !== "custom" && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 text-xs"
                onClick={saveContextPath}
                title="Mémoriser ce context path pour cette API (dev + rec)"
              >
                <Save className="size-3" /> Enregistrer pour cette API
              </Button>
            )}
          </div>
          <div className="bg-muted text-foreground border-border rounded-md border px-3 py-2 font-mono text-xs break-all">
            {composedUrl}
          </div>
        </CardBody>
      </Card>
      )}

      {simplified ? (
        (fetchingToken || tokenError) && (
          <div
            className={`rounded-md border px-3 py-2 text-xs ${
              tokenError
                ? "border-destructive/40 text-destructive"
                : "text-muted-foreground border-border"
            }`}
          >
            {fetchingToken ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> Authentification…
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span>Authentification impossible : {tokenError}</span>
                <button
                  type="button"
                  onClick={() => void getToken()}
                  className="font-medium underline"
                >
                  Réessayer
                </button>
                <a href="/settings" className="underline">
                  Paramètres
                </a>
              </div>
            )}
          </div>
        )
      ) : (
        <Card>
          <CardHeader>
            <KeyRound className="text-muted-foreground size-3.5" />
            <span className="font-semibold">Authentification</span>
          </CardHeader>
          <CardBody className="space-y-3 p-3">
            <Field
              label="Scopes OAuth2"
              hint="Les scopes requis par l'opération sont déjà cochés — en cas de doute, laissez tel quel."
            >
              <ScopeSelector
                available={scopes}
                selected={selectedScopes}
                onChange={setSelectedScopes}
                required={requiredScopes}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => void getToken()}
                disabled={fetchingToken}
              >
                {fetchingToken ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <KeyRound className="size-3.5" />
                )}
                {fetchingToken ? "Demande en cours…" : "Obtenir un token"}
              </Button>
              {tokenError && (
                <span className="text-destructive text-xs">{tokenError}</span>
              )}
              <span className="text-muted-foreground ml-auto text-xs">
                clientId/secret se configurent dans{" "}
                <a href="/settings" className="underline">
                  Paramètres
                </a>
              </span>
            </div>
            <TokenInspector token={token} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="p-3">
          <Tabs
            // Keep every tab mounted so a body-tab `const` discriminator
            // (e.g. DecisionCreate's `outcome`) self-emits even when the form
            // opens on the Paramètres tab — otherwise the body ships as `{}`.
            mountAll
            tabs={[
              ...(pathParams.length || queryParams.length
                ? [
                    {
                      id: "params",
                      label: "Paramètres",
                      count: pathParams.length + queryParams.length,
                      content: (
                        <div className="space-y-3">
                          {pathParams.length > 0 && (
                            <ParamGroup
                              title="Path"
                              params={pathParams}
                              values={paramValues}
                              onChange={setParamValues}
                            />
                          )}
                          {queryParams.length > 0 && (
                            <ParamGroup
                              title="Query"
                              params={queryParams}
                              values={paramValues}
                              onChange={setParamValues}
                            />
                          )}
                        </div>
                      ),
                    },
                  ]
                : []),
              ...(hasBody
                ? [
                    {
                      id: "body",
                      label: "Corps",
                      content: (
                        <RequestBodyTab
                          bodySchema={bodySchema}
                          multipartSchema={multipartSchema}
                          multipartEncoding={multipartMedia?.encoding}
                          value={bodyValue}
                          onChange={setBodyValue}
                          files={files}
                          onFilesChange={setFiles}
                        />
                      ),
                    },
                  ]
                : []),
              ...(!simplified
                ? [
                    {
                      id: "headers",
                      label: "En-têtes",
                      count: customHeaders.length,
                      content: (
                        <HeaderEditor
                          value={customHeaders}
                          onChange={setCustomHeaders}
                          managed={managedHeaders}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="success"
          onClick={run}
          disabled={running || (simplified && (fetchingToken || !!tokenError))}
          title={
            isMac ? "Exécuter (⌘ + Entrée)" : "Exécuter (Ctrl + Entrée)"
          }
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          {running ? "Exécution…" : "Exécuter"}
          <kbd className="ml-1 hidden rounded border border-white/40 bg-white/15 px-1 font-mono text-[10px] font-medium sm:inline-block">
            {isMac ? "⌘↵" : "Ctrl↵"}
          </kbd>
        </Button>
        {!simplified && (
          <>
            <Button variant="outline" onClick={exportBruno}>
          <Download className="size-3.5" /> Exporter (Bruno)
        </Button>
        <Button variant="outline" onClick={copyCurl}>
          <Terminal className="size-3.5" /> Copier en curl
            </Button>
          </>
        )}
      </div>

      {uploading && (
        <div
          role="status"
          className="border-border bg-muted/40 space-y-1.5 rounded-md border p-3"
        >
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              Envoi du fichier en cours…
            </span>
            <span className="font-mono">{formatUploadSize(files)}</span>
          </div>
          <Progress aria-label="Envoi du fichier en cours" />
        </div>
      )}
        </div>

        {/* Fixed working height once two-column: the response card fills it and
            each tab scrolls internally, so the panel's bottom edge stays aligned
            with the left column instead of ending wherever content runs out. */}
        <div
          className={
            compactResponse
              ? "min-w-0 @min-[61rem]:relative @min-[61rem]:self-stretch"
              : "min-w-0 @min-[61rem]:sticky @min-[61rem]:top-[4.5rem] @min-[61rem]:self-start"
          }
        >
          <div
            className={
              compactResponse
                ? "@min-[61rem]:absolute @min-[61rem]:inset-0 @min-[61rem]:flex @min-[61rem]:flex-col"
                : "@min-[61rem]:flex @min-[61rem]:h-[calc(100vh-5.5rem)] @min-[61rem]:flex-col"
            }
          >
          {/* URL of the resource actually shown below — the operation URL, or
              the followed HAL link while navigating. Kept here (not on the
              stable "URL composée" card) so it tracks what the response is. */}
          <div className="text-muted-foreground mb-2 flex items-baseline gap-1.5 px-1 font-mono text-xs @min-[61rem]:shrink-0">
            <span className="text-foreground shrink-0 font-sans font-semibold">
              {effective.method}
            </span>
            <span className="break-all">{effective.url}</span>
          </div>
          <div className="@min-[61rem]:flex @min-[61rem]:min-h-0 @min-[61rem]:flex-1 @min-[61rem]:flex-col">
          <ResponsePanel
            response={currentResponse}
            error={error}
            apiBaseUrl={baseUrl}
            exportMeta={{
              apiTitle,
              endpoint: effective.defaultName,
              url: effective.url,
              summary: isFollowing ? undefined : operation.summary,
            }}
            onFollowLink={followLink}
            navStack={followStack.map((e) => ({ url: e.url, label: e.label }))}
            onNavBack={navBack}
            onNavJumpTo={navJumpTo}
            onNavToOperation={navToOperation}
          />
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ParamGroup({
  title,
  params,
  values,
  onChange,
}: {
  title: string;
  params: OpenApiParameter[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wider">
        {title}
      </div>
      <div className="space-y-2.5">
        {params.map((p) => (
          <Field
            key={p.name}
            label={p.name}
            hint={p.description}
            required={p.required}
            meta={<ConstraintBadges schema={p.schema} />}
          >
            {p.schema?.enum?.length ? (
              <Select
                value={values[p.name] ?? ""}
                onValueChange={(v) => onChange({ ...values, [p.name]: v })}
              >
                <SelectTrigger
                  className="w-full"
                  aria-required={p.required || undefined}
                >
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {p.schema.enum.map((v) => (
                    <SelectItem key={String(v)} value={String(v)}>
                      {String(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={values[p.name] ?? ""}
                aria-required={p.required || undefined}
                onChange={(e) =>
                  onChange({ ...values, [p.name]: e.target.value })
                }
                className="h-8 font-mono text-sm"
              />
            )}
          </Field>
        ))}
      </div>
    </div>
  );
}

// The "Corps" tab body: a JSON body form, a multipart upload form, or nothing
// (GET / no request body). Owns the JSON-vs-multipart branch so the parent
// component's body stays a flat orchestration.
function RequestBodyTab({
  bodySchema,
  multipartSchema,
  multipartEncoding,
  value,
  onChange,
  files,
  onFilesChange,
}: {
  bodySchema: JsonSchema | undefined;
  multipartSchema: JsonSchema | undefined;
  multipartEncoding: Record<string, { contentType?: string }> | undefined;
  value: unknown;
  onChange: (next: unknown) => void;
  files: Record<string, File | null>;
  onFilesChange: (next: Record<string, File | null>) => void;
}) {
  if (bodySchema) {
    return <BodySection schema={bodySchema} value={value} onChange={onChange} />;
  }
  if (multipartSchema) {
    return (
      <MultipartBodySection
        schema={multipartSchema}
        encoding={multipartEncoding}
        value={value}
        onChange={onChange}
        files={files}
        onFilesChange={onFilesChange}
      />
    );
  }
  return null;
}

function BodySection({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const [mode, setMode] = useState<"form" | "raw">("form");
  return (
    <div className="space-y-3">
      <div className="bg-muted text-muted-foreground inline-flex items-center rounded-lg p-1 text-xs">
        <button
          type="button"
          onClick={() => setMode("form")}
          data-state={mode === "form" ? "on" : "off"}
          className="data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm rounded-md px-2.5 py-1 font-medium transition-colors"
        >
          Formulaire
        </button>
        <button
          type="button"
          onClick={() => setMode("raw")}
          data-state={mode === "raw" ? "on" : "off"}
          className="data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm rounded-md px-2.5 py-1 font-medium transition-colors"
        >
          JSON brut
        </button>
      </div>
      {mode === "form" ? (
        <SchemaField schema={schema} value={value} onChange={onChange} />
      ) : (
        <JsonEditor value={value} onChange={onChange} />
      )}
    </div>
  );
}


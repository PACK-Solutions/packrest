"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, KeyRound, Loader2, Play, Save, Terminal } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardBody } from "@/components/Card";
import Tabs from "@/components/Tabs";
import MethodBadge from "@/components/MethodBadge";
import Field from "@/components/Field";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  executeRequest,
  fileToBase64,
  type MultipartPayload,
  type ProxyResponse,
} from "@/lib/http";
import {
  loadSettings,
  saveSettings,
  SETTINGS_CHANGED_EVENT,
  type SavedHeader,
} from "@/lib/storage";
import {
  serializeRequestYml,
  IMPORT_SEED_KEY,
  type BrunoHeader,
  type BrunoParam,
  type BrunoRequest,
  type ImportSeed,
} from "@/lib/bruno";
import { fetchToken, currentToken, clearToken } from "@/lib/token";
import {
  resolveBaseUrl,
  resolveTokenUrl,
  contextPathFromBaseUrl,
  defaultContextPathFor,
} from "@/lib/env";
import type { TokenState } from "@/lib/storage";
import type {
  OpenApiOperation,
  OpenApiParameter,
  JsonSchema,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  apiId: string;
  method: string;
  path: string;
  operationId: string;
  operation: OpenApiOperation;
  pathParameters: OpenApiParameter[];
  defaultBaseUrl: string;
  scopes: Record<string, string>;
  tokenUrl: string;
}

// One entry per HAL follow. Responses are cached so Précédent / breadcrumb
// jumps don't re-fetch (avoids spamming the gateway when navigating back).
interface FollowEntry {
  url: string;
  label: string;
  response: ProxyResponse;
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
    method,
    path,
    operationId,
    operation,
    pathParameters,
    defaultBaseUrl,
    scopes,
    tokenUrl,
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
        resolveBaseUrl(apiId, s.environment, s.baseUrl, defaultBaseUrl, s.apiPaths),
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
      const seed: Record<string, string> = {};
      for (const p of allParams) seed[p.name] = "";
      return seed;
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
  const [bodyValue, setBodyValue] = useState<unknown>(null);

  // multipart/form-data endpoints (file upload). When there's no JSON body but
  // a multipart one, the "Corps" tab renders a file picker + metadata form and
  // the request is sent as a real multipart body (rebuilt in /api/proxy).
  const multipartMedia = operation.requestBody?.content?.["multipart/form-data"];
  const multipartSchema: JsonSchema | undefined = multipartMedia?.schema;
  const isMultipart = !bodySchema && !!multipartSchema;
  const [files, setFiles] = useState<Record<string, File | null>>({});

  const [customHeaders, setCustomHeaders] = useState<SavedHeader[]>([]);

  const requiredScopes = (operation.security ?? []).flatMap((e) =>
    Object.values(e).flat(),
  );
  const [selectedScopes, setSelectedScopes] =
    useState<string[]>(requiredScopes);

  // Token panel + UX feedback. Token is tracked as React state so the
  // Authorization header in every code path always reflects the freshest
  // bearer — reading localStorage directly inside event handlers is racy
  // with React's render cycle.
  const [token, setToken] = useState<TokenState | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [fetchingToken, setFetchingToken] = useState(false);
  useEffect(() => {
    setToken(currentToken());
    const sync = () => setToken(currentToken());
    const id = window.setInterval(sync, 1000);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Operation's own response (set by handleRun). The current displayed
  // response is either this or the top of `followStack` if non-empty.
  const [response, setResponse] = useState<ProxyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // HAL navigation: every "Suivre" pushes a {url, label, response} entry;
  // back/jump pops without re-fetching (each response is cached). When the
  // stack is non-empty the user is "off" the operation — handleSave /
  // handleCopyCurl use the stack's top URL and response.
  const [followStack, setFollowStack] = useState<FollowEntry[]>([]);

  // One-shot seeding from a Bruno import. The /collections importer writes the
  // chosen request into sessionStorage then navigates here; we apply the values
  // once on mount and clear the key so a refresh starts clean.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(IMPORT_SEED_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    window.sessionStorage.removeItem(IMPORT_SEED_KEY);
    let seed: ImportSeed;
    try {
      seed = JSON.parse(raw) as ImportSeed;
    } catch {
      return;
    }
    if (seed.apiId !== apiId || seed.operationId !== operationId) return;
    if (seed.params) setParamValues((prev) => ({ ...prev, ...seed.params }));
    if (seed.headers) setCustomHeaders(seed.headers);
    if (seed.body !== undefined) setBodyValue(seed.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentResponse: ProxyResponse | null =
    followStack.length > 0
      ? followStack[followStack.length - 1].response
      : response;

  const composedUrl = useMemo(() => {
    const filledPath = path.replace(/\{([^}]+)\}/g, (_, name) =>
      encodeURIComponent(paramValues[name] ?? ""),
    );
    const qs = queryParams
      .filter((p) => (paramValues[p.name] ?? "") !== "")
      .map(
        (p) =>
          `${encodeURIComponent(p.name)}=${encodeURIComponent(paramValues[p.name])}`,
      )
      .join("&");
    return `${baseUrl}${filledPath}${qs ? `?${qs}` : ""}`;
  }, [baseUrl, path, queryParams, paramValues]);

  const handleGetToken = async () => {
    setTokenError(null);
    setFetchingToken(true);
    try {
      const s = loadSettings();
      if (!s.clientId || !s.clientSecret) {
        throw new Error(
          "Configurez clientId et clientSecret dans Paramètres avant de demander un token.",
        );
      }
      const fresh = await fetchToken({
        tokenUrl: resolveTokenUrl(s.environment, s.tokenUrl, tokenUrl),
        clientId: s.clientId,
        clientSecret: s.clientSecret,
        scopes: selectedScopes,
      });
      setToken(fresh);
      toast.success("Token obtenu", {
        description: `Scopes : ${fresh.scope ?? "(non renvoyé)"}`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      setTokenError(msg);
      toast.error("Impossible d'obtenir un token", { description: msg });
    } finally {
      setFetchingToken(false);
    }
  };

  // Enabled custom headers plus the current bearer. Shared by run / follow /
  // curl so the Authorization + custom-header logic lives in one place.
  // Canonical capital `Bearer` — RFC 7235 says case-insensitive, but Gravitee
  // (and some other gateways) reject lowercase `bearer`.
  const buildLiveHeaders = (): Record<string, string> => {
    const live = currentToken() ?? token;
    const headers: Record<string, string> = {};
    for (const h of customHeaders) {
      if (h.enabled !== false && h.key) headers[h.key] = h.value;
    }
    if (live) headers["Authorization"] = `Bearer ${live.accessToken}`;
    return headers;
  };

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResponse(null);
    setFollowStack([]);
    try {
      const headers = buildLiveHeaders();
      const wantsBody = !["GET", "HEAD"].includes(method.toUpperCase());
      const res = await executeRequest({
        method,
        url: composedUrl,
        headers,
        body: wantsBody && !isMultipart ? (bodyValue as object) : undefined,
        multipart:
          isMultipart && wantsBody
            ? await buildMultipart(bodyValue, files)
            : undefined,
      });
      setResponse(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  // Follow a HAL link in-app: fire a GET via the proxy with the current
  // Authorization header. On success, push the result onto followStack
  // (which becomes the displayed response). On error, leave the stack
  // untouched so the user stays on the previous valid view.
  const handleFollowLink = async (url: string, label: string) => {
    setRunning(true);
    setError(null);
    try {
      const res = await executeRequest({
        method: "GET",
        url,
        headers: buildLiveHeaders(),
        body: undefined,
      });
      setFollowStack((s) => [...s, { url, label, response: res }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  // Pop the top of the stack — caches mean no re-fetch. Clears any error
  // so the previous response shows cleanly.
  const handleNavBack = () => {
    setError(null);
    setFollowStack((s) => s.slice(0, -1));
  };

  // Truncate the stack so segment `index` becomes the top — used by the
  // breadcrumb when the user clicks an earlier rel.
  const handleNavJumpTo = (index: number) => {
    setError(null);
    setFollowStack((s) => s.slice(0, index + 1));
  };

  // Clear the entire follow stack — back to the operation's own response.
  const handleNavToOperation = () => {
    setError(null);
    setFollowStack([]);
  };

  // When the user is mid-navigation (followStack non-empty), Save and
  // Copy-curl describe the *currently visible* request — a GET on the
  // followed URL — not the original operation.
  const isFollowing = followStack.length > 0;
  const effectiveUrl = isFollowing
    ? followStack[followStack.length - 1].url
    : composedUrl;
  const effectiveMethod = isFollowing ? "GET" : method;
  const effectiveBody = isFollowing ? undefined : bodyValue;
  const effectiveDefaultName = isFollowing
    ? `GET ${followStack[followStack.length - 1].label}`
    : `${method.toUpperCase()} ${path}`;

  // Export the currently-composed request as a single Bruno request file
  // (.yml). Mirrors the "Copier en curl" mental model: what you export is what
  // would be sent (the operation request, or the followed URL when navigating).
  const handleExportBruno = () => {
    const params: BrunoParam[] = [];
    if (!isFollowing) {
      for (const p of pathParams) {
        params.push({
          name: p.name,
          value: paramValues[p.name] ?? "",
          type: "path",
          description: p.description,
        });
      }
      for (const p of queryParams) {
        const value = paramValues[p.name] ?? "";
        if (value === "") continue;
        params.push({
          name: p.name,
          value,
          type: "query",
          description: p.description,
        });
      }
    }
    const headers: BrunoHeader[] = customHeaders
      .filter((h) => h.key)
      .map((h) => ({
        name: h.key,
        value: h.value,
        disabled: h.enabled === false,
      }));
    const wantsBody = !["GET", "HEAD"].includes(effectiveMethod.toUpperCase());
    // Bruno's opencollection body model here is json/text only — a binary
    // multipart upload can't round-trip through the YAML. Export the request
    // shape without the body and note it so the user re-attaches the file in
    // Bruno rather than shipping a misleading JSON body.
    const asMultipart = wantsBody && isMultipart && !isFollowing;
    const docs = asMultipart
      ? [
          operation.summary,
          "⚠️ Requête multipart/form-data : ajoutez le fichier et les champs du formulaire dans Bruno (corps non exporté).",
        ]
          .filter(Boolean)
          .join("\n\n")
      : operation.summary;
    const req: BrunoRequest = {
      name: effectiveDefaultName,
      tags: [apiId],
      method: effectiveMethod.toUpperCase(),
      url: effectiveUrl,
      params: params.length ? params : undefined,
      headers: headers.length ? headers : undefined,
      body:
        !asMultipart && wantsBody && effectiveBody != null
          ? { type: "json", data: JSON.stringify(effectiveBody, null, 2) }
          : undefined,
      docs,
    };
    const blob = new Blob([serializeRequestYml(req)], {
      type: "application/yaml",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${effectiveDefaultName.replace(/[/\\]+/g, "-").trim() || "request"}.yml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Requête exportée (Bruno)");
  };

  // Persist the context path of the current API, derived from the edited base
  // URL. Preset envs only — the host stays the preset's, only the path segment
  // is stored (so it applies to both dev and rec).
  const handleSaveContextPath = () => {
    const s = loadSettings();
    const ctx = contextPathFromBaseUrl(s.environment, baseUrl);
    if (ctx === null) {
      toast.info("Host non reconnu", {
        description:
          "Pour un host différent des passerelles dev/rec, utilisez l'environnement Personnalisé.",
      });
      return;
    }
    const apiPaths = { ...(s.apiPaths ?? {}) };
    // Don't persist an override that just restates the default.
    if (ctx === defaultContextPathFor(apiId)) delete apiPaths[apiId];
    else apiPaths[apiId] = ctx;
    saveSettings({ ...s, apiPaths });
    toast.success(`Context path enregistré pour « ${apiId} »`, {
      description: ctx ? `/${ctx}` : "(racine de la passerelle)",
    });
  };

  const handleCopyCurl = () => {
    const headers = buildLiveHeaders();
    const wantsBody = !["GET", "HEAD"].includes(effectiveMethod.toUpperCase());
    // A multipart upload only applies to the operation request, not to a
    // followed GET (isFollowing collapses effectiveMethod to GET).
    const asMultipart = wantsBody && isMultipart && !isFollowing;
    if (wantsBody && effectiveBody && !asMultipart) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    const form = asMultipart ? curlForm(bodyValue, files) : undefined;
    const curl = buildCurl({
      method: effectiveMethod,
      url: effectiveUrl,
      headers,
      body:
        wantsBody && effectiveBody && !asMultipart
          ? JSON.stringify(effectiveBody, null, 2)
          : null,
      form,
    });
    navigator.clipboard.writeText(curl).then(
      () => toast.success("Commande curl copiée"),
      () => toast.error("Échec de la copie"),
    );
  };

  // The "Corps" tab renders a JSON body form, a multipart upload form, or
  // nothing (GET / no request body).
  const bodyContent = bodySchema ? (
    <BodySection schema={bodySchema} value={bodyValue} onChange={setBodyValue} />
  ) : isMultipart ? (
    <MultipartBodySection
      schema={multipartSchema!}
      encoding={multipartMedia?.encoding}
      value={bodyValue}
      onChange={setBodyValue}
      files={files}
      onFilesChange={setFiles}
    />
  ) : null;

  // Greyed-out managed rows shown in the header editor: the (masked) bearer
  // and the Content-Type the proxy will set for the body.
  const managedHeaders = [
    ...(token
      ? [{ key: "Authorization", value: `Bearer ${maskToken(token.accessToken)}` }]
      : []),
    ...managedContentType(!!bodySchema, isMultipart),
  ];

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
                onClick={handleSaveContextPath}
                title="Mémoriser ce context path pour cette API (dev + rec)"
              >
                <Save className="size-3" /> Enregistrer pour cette API
              </Button>
            )}
          </div>
          <div
            className={cn(
              "rounded-md border px-3 py-2 font-mono text-xs break-all",
              isFollowing
                ? "bg-muted/50 text-muted-foreground border-border line-through"
                : "bg-muted text-foreground border-border",
            )}
            title={
              isFollowing
                ? "URL de l'opération — la navigation HAL utilise une autre URL (voir le panneau de réponse)"
                : undefined
            }
          >
            {composedUrl}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <KeyRound className="text-muted-foreground size-3.5" />
          <span className="font-semibold">Authentification</span>
        </CardHeader>
        <CardBody className="space-y-3 p-3">
          <Field
            label="Scopes OAuth2"
            hint="Sélectionnez les scopes à demander à l'IAM. Les scopes requis par l'opération sont marqués."
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
              variant="gradient"
              size="sm"
              onClick={handleGetToken}
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

      <Card>
        <CardBody className="p-3">
          <Tabs
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
              ...(bodyContent
                ? [{ id: "body", label: "Corps", content: bodyContent }]
                : []),
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
            ]}
          />
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="success" onClick={handleRun} disabled={running}>
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          {running ? "Exécution…" : "Exécuter"}
        </Button>
        <Button variant="outline" onClick={handleExportBruno}>
          <Download className="size-3.5" /> Exporter (Bruno)
        </Button>
        <Button variant="outline" onClick={handleCopyCurl}>
          <Terminal className="size-3.5" /> Copier en curl
        </Button>
      </div>

      <ResponsePanel
        response={currentResponse}
        error={error}
        apiBaseUrl={baseUrl}
        onFollowLink={handleFollowLink}
        navStack={followStack.map((e) => ({ url: e.url, label: e.label }))}
        onNavBack={handleNavBack}
        onNavJumpTo={handleNavJumpTo}
        onNavToOperation={handleNavToOperation}
      />
    </div>
  );
}

// Assemble a MultipartPayload from the metadata object + picked files. Empty
// metadata fields are dropped; non-string values are JSON-encoded (e.g. the
// `metadata` object part). Files are base64-encoded for transport to the proxy.
async function buildMultipart(
  value: unknown,
  files: Record<string, File | null>,
): Promise<MultipartPayload> {
  const fields: Record<string, string> = {};
  const obj = (
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    fields[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  const out: MultipartPayload["files"] = [];
  for (const [field, f] of Object.entries(files)) {
    if (!f) continue;
    out.push({
      field,
      filename: f.name,
      contentType: f.type || "application/octet-stream",
      base64: await fileToBase64(f),
    });
  }
  return { fields, files: out };
}

// Same field/file collection as buildMultipart, but shaped for a curl `-F`
// preview (filenames only, no base64).
function curlForm(
  value: unknown,
  files: Record<string, File | null>,
): { fields: Record<string, string>; files: { field: string; filename: string }[] } {
  const fields: Record<string, string> = {};
  const obj = (
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    fields[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  const outFiles: { field: string; filename: string }[] = [];
  for (const [field, f] of Object.entries(files)) {
    if (f) outFiles.push({ field, filename: f.name });
  }
  return { fields, files: outFiles };
}

// The Content-Type the proxy will set, as a managed header row. JSON bodies
// are stamped application/json; multipart uploads get the boundary from fetch,
// so we only show the bare type. GET / bodyless requests get no row.
function managedContentType(
  hasJsonBody: boolean,
  isMultipart: boolean,
): { key: string; value: string }[] {
  if (hasJsonBody) return [{ key: "Content-Type", value: "application/json" }];
  if (isMultipart)
    return [{ key: "Content-Type", value: "multipart/form-data" }];
  return [];
}

function maskToken(token: string): string {
  if (token.length <= 12) return "••••";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

// Build a curl command exactly mirroring what the proxy will send. Used by
// the "Copier en curl" button so the user can paste a working command into
// a terminal and compare diff with their own curl.
export function buildCurl(opts: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | null;
  // multipart/form-data parts. When present, `-F` flags are emitted (and
  // curl sets the multipart Content-Type + boundary itself) instead of
  // `--data-raw`.
  form?: {
    fields: Record<string, string>;
    files: { field: string; filename: string }[];
  };
}): string {
  const lines: string[] = [
    `curl -X ${opts.method.toUpperCase()} '${escapeSingleQuotes(opts.url)}'`,
  ];
  for (const [k, v] of Object.entries(opts.headers)) {
    lines.push(`-H '${escapeSingleQuotes(`${k}: ${v}`)}'`);
  }
  if (opts.form) {
    for (const [k, v] of Object.entries(opts.form.fields)) {
      lines.push(`-F '${escapeSingleQuotes(`${k}=${v}`)}'`);
    }
    for (const f of opts.form.files) {
      lines.push(`-F '${escapeSingleQuotes(`${f.field}=@${f.filename}`)}'`);
    }
  } else if (opts.body) {
    lines.push(`--data-raw '${escapeSingleQuotes(opts.body)}'`);
  }
  return lines.join(" \\\n  ");
}

function escapeSingleQuotes(s: string): string {
  return s.replace(/'/g, "'\\''");
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
          >
            {p.schema?.enum?.length ? (
              <Select
                value={values[p.name] ?? ""}
                onValueChange={(v) => onChange({ ...values, [p.name]: v })}
              >
                <SelectTrigger className="w-full">
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


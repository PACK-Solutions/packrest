"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, X } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardBody } from "@/components/Card";
import StatusBadge from "@/components/StatusBadge";
import Tabs from "@/components/Tabs";
import {
  JsonHighlighted,
  JsonTree,
  parseIfJsonString,
} from "@/components/JsonView";
import HalLinks from "@/components/HalLinks";
import FileResponse from "@/components/FileResponse";
import ResponseExportButton from "@/components/ResponseExportButton";
import { Button } from "@/components/ui/button";
import type { ExportMeta } from "@/lib/xlsx";
import { CODE_SURFACE, toneForStatusCode } from "@/lib/design";
import { statusHelp } from "@/lib/status-help";
import { cn } from "@/lib/utils";
import {
  extractHalLinks,
  isHalHrefPath,
  makeHalLinkResolver,
  pathToHalLabel,
} from "@/lib/hal";
import type { ProxyResponse } from "@/lib/http";

// A single segment of HAL navigation — owned by RequestBuilder. The
// response itself is kept on the parent side (so back/jump don't re-fetch);
// here we only need the label and URL for display.
export interface NavSegment {
  url: string;
  label: string;
}

interface Props {
  response: ProxyResponse | null;
  error?: string | null;
  // API root URL (with path prefix, e.g. `https://gw.example.com/person`).
  // Used to resolve relative HAL hrefs — must NOT be the request's full URL.
  apiBaseUrl?: string;
  // When set, clicking a HAL link calls this instead of navigating away.
  // `label` is a short, human-friendly name (HAL rel) used for the
  // navigation breadcrumb.
  onFollowLink?: (url: string, label: string) => void;
  // HAL navigation state lifted from the parent. When `navStack` is
  // non-empty, the breadcrumb is rendered inside the response card just
  // above the tabs (so it stays next to the JSON the user is reading).
  navStack?: NavSegment[];
  onNavBack?: () => void;
  onNavJumpTo?: (index: number) => void;
  onNavToOperation?: () => void;
  // Request context (API / endpoint / query) embedded in the Excel export.
  exportMeta?: ExportMeta;
}

// Default export filename derived from the request URL's last path segment
// (query stripped, sanitized), falling back to "reponse".
function responseFileBase(url?: string): string {
  if (!url) return "reponse";
  try {
    const { pathname } = new URL(url);
    const last = pathname.split("/").filter(Boolean).pop() ?? "";
    const slug = last.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "reponse";
  } catch {
    return "reponse";
  }
}

export default function ResponsePanel({
  response,
  error,
  apiBaseUrl = "",
  onFollowLink,
  navStack,
  onNavBack,
  onNavJumpTo,
  onNavToOperation,
  exportMeta,
}: Props) {
  // Parse the body once here so BodyView and the Liens tab share the same
  // structured representation. Hooks must come before any conditional
  // return — call them unconditionally and accept null body.
  const parsedBody = useMemo(
    () => (response ? parseIfJsonString(response.body) : null),
    [response],
  );
  const halLinks = useMemo(
    () => (response ? extractHalLinks(parsedBody) : []),
    [response, parsedBody],
  );

  if (error) {
    return (
      <Card tone="danger">
        <CardHeader tone="danger">
          <span className="font-semibold">Erreur d&apos;exécution</span>
        </CardHeader>
        <CardBody>
          <pre className="text-destructive whitespace-pre-wrap text-xs">
            {error}
          </pre>
        </CardBody>
      </Card>
    );
  }
  if (!response) {
    return (
      <Card>
        <CardBody className="p-6 text-center">
          <p className="text-muted-foreground text-sm">
            Aucune réponse — exécutez la requête pour voir le résultat.
          </p>
        </CardBody>
      </Card>
    );
  }
  // `status: 0` is our synthetic "the request never completed" marker (network
  // down, host unreachable, timeout — see lib/http.ts). Treat it as an error
  // (danger tone) rather than the neutral grey a raw 0 would map to.
  const isNetworkError = response.status === 0;
  const tone = toneForStatusCode(isNetworkError ? 500 : response.status);
  // Plain-language diagnosis for non-devs — non-null for the network error and
  // every 4xx/5xx; the full raw response stays available in the tabs below.
  const help = statusHelp(response.status);
  const showNav = navStack && navStack.length > 0;
  return (
    <Card tone={tone.tone} className="xl:h-full xl:min-h-0">
      <CardHeader tone={tone.tone}>
        {isNetworkError ? (
          <StatusBadge label="Échec réseau" tone="danger" size="md" />
        ) : (
          <StatusBadge code={response.status} size="md" />
        )}
        {!isNetworkError && (
          <span className="font-semibold">{response.statusText}</span>
        )}
        <span className="text-muted-foreground ml-auto font-mono text-xs">
          {response.durationMs} ms
        </span>
      </CardHeader>
      <CardBody className="space-y-3 p-3 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
        {help && (
          <div
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              tone.soft,
              tone.border,
            )}
          >
            <p className={cn("font-semibold", tone.textStrong)}>{help.title}</p>
            <p className="text-muted-foreground mt-0.5">{help.explanation}</p>
            {help.action && (
              <p className="text-foreground/80 mt-1">→ {help.action}</p>
            )}
          </div>
        )}
        {showNav && (
          <NavBreadcrumb
            stack={navStack}
            onBack={onNavBack}
            onJumpTo={onNavJumpTo}
            onJumpToOperation={onNavToOperation}
          />
        )}
        <Tabs
          fill
          tabs={[
            {
              id: "body",
              label: "Corps",
              content: response.file ? (
                <FileResponse file={response.file} />
              ) : (
                <BodyView
                  body={response.body}
                  parsedBody={parsedBody}
                  apiBaseUrl={apiBaseUrl}
                  currentUrl={response.request?.url}
                  onFollowLink={onFollowLink}
                  exportMeta={exportMeta}
                />
              ),
            },
            ...(halLinks.length > 0
              ? [
                  {
                    id: "links",
                    label: "Liens",
                    count: halLinks.length,
                    content: (
                      <HalLinks
                        links={halLinks}
                        apiBaseUrl={apiBaseUrl}
                        currentUrl={response.request?.url}
                        onFollow={onFollowLink}
                      />
                    ),
                  },
                ]
              : []),
            {
              id: "headers",
              label: "En-têtes",
              count: Object.keys(response.headers).length,
              content: <HeadersTable headers={response.headers} />,
            },
            ...(response.request
              ? [
                  {
                    id: "request",
                    label: "Requête envoyée",
                    content: <RequestSent request={response.request} />,
                  },
                ]
              : []),
          ]}
        />
      </CardBody>
    </Card>
  );
}

function BodyView({
  body,
  parsedBody,
  apiBaseUrl,
  currentUrl,
  onFollowLink,
  exportMeta,
}: {
  body: unknown;
  parsedBody: unknown;
  apiBaseUrl: string;
  currentUrl?: string;
  onFollowLink?: (url: string, label: string) => void;
  exportMeta?: ExportMeta;
}) {
  const isEmpty =
    parsedBody === null ||
    parsedBody === undefined ||
    (typeof parsedBody === "string" && parsedBody.trim() === "");
  const isStructured =
    parsedBody !== null &&
    (typeof parsedBody === "object" || Array.isArray(parsedBody));
  // Default to raw Json; the readable "Lisible" tree stays a toggle away
  // (and is disabled when the body isn't structured).
  const [view, setView] = useState<"json" | "tree">("json");
  const pretty = useMemo(() => {
    if (typeof parsedBody === "string") return parsedBody;
    try {
      return JSON.stringify(parsedBody, null, 2);
    } catch {
      return String(parsedBody);
    }
  }, [parsedBody]);
  const linkResolver = useMemo(
    () => makeHalLinkResolver(apiBaseUrl, currentUrl),
    [apiBaseUrl, currentUrl],
  );
  // Adapt JsonView's `(url, path)` click signature to the parent's
  // `(url, label)` follow API.
  const onLinkClick = useMemo(
    () =>
      onFollowLink
        ? (url: string, path: readonly string[]) =>
            onFollowLink(url, pathToHalLabel(path))
        : undefined,
    [onFollowLink],
  );
  void body;
  if (isEmpty) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        Réponse sans corps.
      </p>
    );
  }
  return (
    <div className="space-y-2 xl:flex xl:h-full xl:min-h-0 xl:flex-col">
      <div className="flex items-center gap-1.5">
        <ViewToggle
          active={view === "json"}
          onClick={() => setView("json")}
          label="Json"
        />
        <ViewToggle
          active={view === "tree"}
          onClick={() => setView("tree")}
          label="Lisible"
          disabled={!isStructured}
          title={
            isStructured
              ? undefined
              : "Indisponible : la réponse n'est pas un JSON structuré."
          }
        />
        <div className="ml-auto flex items-center gap-1.5">
          <ResponseExportButton
            body={parsedBody}
            defaultName={responseFileBase(currentUrl)}
            meta={exportMeta}
            disabled={!isStructured}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              navigator.clipboard.writeText(pretty).then(
                () => toast.success("Corps de la réponse copié"),
                () => toast.error("Échec de la copie"),
              )
            }
          >
            <Copy className="size-3" /> Copier
          </Button>
        </div>
      </div>
      {view === "tree" && isStructured ? (
        <JsonTree
          value={parsedBody}
          className="xl:max-h-none xl:min-h-0 xl:flex-1"
          linkResolver={linkResolver}
          onLinkClick={onLinkClick}
          templatedDetector={isHalHrefPath}
        />
      ) : (
        <JsonHighlighted
          value={parsedBody}
          className="xl:max-h-none xl:min-h-0 xl:flex-1"
          linkResolver={linkResolver}
          onLinkClick={onLinkClick}
          templatedDetector={isHalHrefPath}
        />
      )}
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  label,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-state={active ? "on" : "off"}
      className="data-[state=on]:bg-foreground data-[state=on]:text-background bg-muted text-muted-foreground hover:bg-muted/80 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function RequestSent({
  request,
}: {
  request: NonNullable<ProxyResponse["request"]>;
}) {
  return (
    <div className="space-y-3">
      <div className="bg-muted text-foreground border-border rounded-md border px-3 py-2 font-mono text-xs break-all">
        {request.method} {request.url}
      </div>
      <div>
        <div className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
          En-têtes
        </div>
        <HeadersTable headers={request.headers} />
      </div>
      {request.body && (
        <div>
          <div className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
            Corps
          </div>
          <RequestBody body={request.body} />
        </div>
      )}
    </div>
  );
}

function RequestBody({ body }: { body: string }) {
  const parsed = useMemo(() => parseIfJsonString(body), [body]);
  const isStructured =
    parsed !== null && (typeof parsed === "object" || Array.isArray(parsed));
  if (isStructured)
    return (
      <JsonHighlighted value={parsed} className="max-h-[40vh] xl:max-h-none" />
    );
  return (
    <pre
      className={cn(
        CODE_SURFACE,
        "scrollbar-thin max-h-[40vh] overflow-auto p-3 text-xs leading-relaxed xl:max-h-none",
      )}
    >
      {body}
    </pre>
  );
}

// Inline breadcrumb shown at the top of the response card when the user
// has followed at least one HAL link. Designed to be compact: a single
// row of clickable segments + small inline back/close buttons on the
// right (the followed URL is shown above the response panel). Stays visible
// regardless of
// which tab (Corps / Liens / En-têtes / Requête) is active.
function NavBreadcrumb({
  stack,
  onBack,
  onJumpTo,
  onJumpToOperation,
}: {
  stack: NavSegment[];
  onBack?: () => void;
  onJumpTo?: (index: number) => void;
  onJumpToOperation?: () => void;
}) {
  if (stack.length === 0) return null;
  return (
    <div className="border-amber-300 bg-amber-50 dark:border-amber-700/70 dark:bg-amber-900/30 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-xs">
      <span className="text-amber-900 dark:text-amber-50 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={onJumpToOperation}
          title="Revenir à l'opération"
          className="hover:bg-amber-200/60 dark:hover:bg-amber-800/40 rounded px-1.5 py-0.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Opération
        </button>
        {stack.map((entry, i) => {
          const isLast = i === stack.length - 1;
          return (
            <Fragment key={i}>
              <ChevronRight
                className="size-3 shrink-0 opacity-60"
                aria-hidden
              />
              {isLast ? (
                <span
                  className="rounded bg-amber-200 px-1.5 py-0.5 font-bold dark:bg-amber-800/70"
                  aria-current="page"
                >
                  {entry.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onJumpTo?.(i)}
                  className="hover:bg-amber-200/60 dark:hover:bg-amber-800/40 rounded px-1.5 py-0.5 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {entry.label}
                </button>
              )}
            </Fragment>
          );
        })}
      </span>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          onClick={onBack}
          title="Précédent"
          className="hover:bg-amber-200/60 dark:hover:bg-amber-800/40 text-amber-900 dark:text-amber-50 inline-flex h-6 w-6 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onJumpToOperation}
          title="Quitter la navigation HAL"
          className="hover:bg-amber-200/60 dark:hover:bg-amber-800/40 text-amber-900 dark:text-amber-50 inline-flex h-6 w-6 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const rows = Object.entries(headers);
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Pas d&apos;en-tête.</p>
    );
  }
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-muted-foreground text-[10px] uppercase tracking-wider">
        <tr>
          <th className="pb-1.5 pr-3 font-semibold">Nom</th>
          <th className="pb-1.5 font-semibold">Valeur</th>
        </tr>
      </thead>
      <tbody className="divide-border/60 divide-y font-mono">
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="text-foreground py-1 pr-3 align-top">{k}</td>
            <td className="text-muted-foreground break-all py-1">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardBody } from "@/components/Card";
import MethodBadge from "@/components/MethodBadge";
import Markdown from "@/components/Markdown";
import BrunoExportButton from "@/components/BrunoExportButton";
import { apiTheme } from "@/lib/design";
import {
  listEndpoints,
  loadSpec,
  SPECS_CHANGED_EVENT,
  type EndpointEntry,
} from "@/lib/specs";
import type { OpenApiDocument } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function ApiView() {
  const apiId = useSearchParams().get("id") ?? "";
  const [spec, setSpec] = useState<OpenApiDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  // A stale filter from another API would silently hide endpoints.
  useEffect(() => setFilter(""), [apiId]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setLoading(true);
      loadSpec(apiId).then((doc) => {
        if (cancelled) return;
        setSpec(doc);
        setLoading(false);
      });
    };
    load();
    window.addEventListener(SPECS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SPECS_CHANGED_EVENT, load);
    };
  }, [apiId]);

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Chargement de l'API"
        className="mx-auto max-w-6xl space-y-6"
      >
        <Skeleton className="h-4 w-48" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-9 w-full max-w-md" />
        {[0, 1].map((i) => (
          <div key={i} className="bg-card space-y-3 rounded-xl border p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    );
  }
  if (!spec) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <p className="text-sm">
          API introuvable : <code className="font-mono">{apiId}</code>.
        </p>
        <Link href="/" className="text-primary text-sm underline">
          Retour à l&apos;accueil
        </Link>
      </div>
    );
  }

  const endpoints = listEndpoints(spec, apiId);
  const theme = apiTheme(apiId);
  const Icon = theme.icon;

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? endpoints.filter(
        (e) =>
          e.path.toLowerCase().includes(q) ||
          (e.summary ?? "").toLowerCase().includes(q) ||
          e.operationId.toLowerCase().includes(q),
      )
    : endpoints;

  const byTag = new Map<string, EndpointEntry[]>();
  for (const e of filtered) {
    if (!byTag.has(e.tag)) byTag.set(e.tag, []);
    byTag.get(e.tag)!.push(e);
  }
  const tagDescriptions = new Map(
    (spec.tags ?? []).map((t) => [t.name, t.description]),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Accueil</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{spec.info.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex h-12 w-12 items-center justify-center rounded-lg ring-1 ring-inset",
              theme.bg,
              theme.text,
              theme.border,
            )}
          >
            <Icon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">
              {spec.info.title}
            </h1>
            <p
              className="text-muted-foreground truncate text-sm"
              title={spec.servers?.[0]?.url}
            >
              v{spec.info.version} ·{" "}
              <span className="font-mono">{spec.servers?.[0]?.url}</span>
            </p>
          </div>
          <div className="ml-auto">
            <BrunoExportButton apiId={apiId} title={spec.info.title} />
          </div>
        </div>
        {spec.info.description && (
          <Markdown
            content={spec.info.description}
            className="text-muted-foreground max-w-3xl"
            collapsible
          />
        )}
      </header>

      <div className="relative max-w-md">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer les endpoints (chemin, résumé, operationId)…"
          aria-label="Filtrer les endpoints"
          className="h-9 pl-8"
        />
      </div>

      {q && filtered.length === 0 && (
        <Card>
          <CardBody className="p-6 text-center">
            <p className="text-muted-foreground text-sm">
              Aucun endpoint ne correspond à « {filter} ».
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setFilter("")}
            >
              Effacer le filtre
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="space-y-5">
        {[...byTag.entries()].map(([tag, items]) => (
          <Card key={tag}>
            <CardHeader>
              <span className="font-semibold capitalize">{tag}</span>
              <Badge variant="neutral" className="ml-auto rounded-full">
                {items.length}
              </Badge>
            </CardHeader>
            {tagDescriptions.get(tag) && (
              <div className="border-border/60 border-b px-3 py-2.5">
                <Markdown
                  content={tagDescriptions.get(tag)}
                  className="text-muted-foreground"
                  collapsible
                />
              </div>
            )}
            <CardBody className="p-0">
              <ul className="divide-border/60 divide-y">
                {items.map((e) => (
                  <li key={e.operationId}>
                    <Link
                      href={`/endpoint?api=${encodeURIComponent(apiId)}&op=${encodeURIComponent(e.operationId)}`}
                      className="hover:bg-accent/60 group flex items-center gap-3 px-3 py-2.5 transition"
                    >
                      <MethodBadge method={e.method} className="shrink-0" />
                      <code
                        className="text-foreground min-w-0 shrink truncate text-xs font-medium"
                        title={e.path}
                      >
                        {e.path}
                      </code>
                      <span className="text-muted-foreground ml-3 min-w-0 flex-1 truncate text-sm">
                        {e.summary}
                      </span>
                      {e.scopes.length > 0 && (
                        <span className="hidden shrink-0 gap-1 md:inline-flex">
                          {e.scopes.map((s) => (
                            <Badge
                              key={s}
                              variant="neutral"
                              className="font-mono text-[10px]"
                            >
                              {s}
                            </Badge>
                          ))}
                        </span>
                      )}
                      <ArrowRight
                        size={14}
                        className="text-muted-foreground/40 group-hover:text-foreground ml-2 shrink-0 transition"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function ApiViewPage() {
  return (
    <Suspense>
      <ApiView />
    </Suspense>
  );
}

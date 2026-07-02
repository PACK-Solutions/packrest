"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import RequestBuilder from "@/components/RequestBuilder";
import {
  extractOAuth2,
  findEndpoint,
  loadSpec,
  type EndpointEntry,
} from "@/lib/specs";
import type { OpenApiDocument } from "@/lib/types";

interface Loaded {
  spec: OpenApiDocument;
  entry: EndpointEntry;
  scopes: Record<string, string>;
  tokenUrl: string;
}

function Endpoint() {
  const params = useSearchParams();
  const apiId = params.get("api") ?? "";
  const operationId = params.get("op") ?? "";
  const [state, setState] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSpec(apiId).then((spec) => {
      if (cancelled) return;
      const entry = spec ? findEndpoint(spec, apiId, operationId) : null;
      if (spec && entry) {
        const oauth = extractOAuth2(spec);
        setState({
          spec,
          entry,
          scopes: oauth?.flows.clientCredentials?.scopes ?? {},
          tokenUrl: oauth?.flows.clientCredentials?.tokenUrl ?? "",
        });
      } else {
        setState(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiId, operationId]);

  if (loading) {
    return (
      <p className="text-muted-foreground animate-pulse text-sm">Chargement…</p>
    );
  }
  if (!state) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <p className="text-sm">
          Opération introuvable : <code className="font-mono">{operationId}</code>{" "}
          dans <code className="font-mono">{apiId}</code>.
        </p>
        <Link href="/" className="text-primary text-sm underline">
          Retour à l&apos;accueil
        </Link>
      </div>
    );
  }

  const { spec, entry, scopes, tokenUrl } = state;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Accueil</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/api-view?id=${encodeURIComponent(apiId)}`}>
                {spec.info.title}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{entry.operationId}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <RequestBuilder
        apiId={apiId}
        method={entry.method.toUpperCase()}
        path={entry.path}
        operationId={entry.operationId}
        operation={entry.operation}
        pathParameters={entry.pathItem.parameters ?? []}
        defaultBaseUrl={spec.servers?.[0]?.url ?? ""}
        scopes={scopes}
        tokenUrl={tokenUrl}
      />
    </div>
  );
}

export default function EndpointPage() {
  return (
    <Suspense>
      <Endpoint />
    </Suspense>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import RequestBuilder from "@/components/RequestBuilder";
import { extractOAuth2, findEndpoint, loadSpec } from "@/lib/specs";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ api: string; operationId: string }>;
}

export default async function OperationPage({ params }: PageProps) {
  const { api: apiId, operationId } = await params;
  const spec = await loadSpec(apiId);
  if (!spec) notFound();
  const entry = findEndpoint(spec, apiId, operationId);
  if (!entry) notFound();
  const oauth = extractOAuth2(spec);
  const scopes = oauth?.flows.clientCredentials?.scopes ?? {};
  const tokenUrl = oauth?.flows.clientCredentials?.tokenUrl ?? "";

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
              <Link href={`/${apiId}`}>{spec.info.title}</Link>
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

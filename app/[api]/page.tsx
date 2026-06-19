import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardBody } from "@/components/Card";
import MethodBadge from "@/components/MethodBadge";
import Markdown from "@/components/Markdown";
import { apiTheme } from "@/lib/design";
import { listEndpoints, loadSpec } from "@/lib/specs";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ api: string }>;
}

export default async function ApiPage({ params }: PageProps) {
  const { api: apiId } = await params;
  const spec = await loadSpec(apiId);
  if (!spec) notFound();
  const endpoints = listEndpoints(spec, apiId);
  const theme = apiTheme(apiId);
  const Icon = theme.icon;

  const byTag = new Map<string, typeof endpoints>();
  for (const e of endpoints) {
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
          <div>
            <h1 className="text-xl font-semibold">{spec.info.title}</h1>
            <p className="text-muted-foreground text-sm">
              v{spec.info.version} ·{" "}
              <span className="font-mono">{spec.servers?.[0]?.url}</span>
            </p>
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
                      href={`/${apiId}/${e.operationId}`}
                      className="hover:bg-accent/60 group flex items-center gap-3 px-3 py-2.5 transition"
                    >
                      <MethodBadge method={e.method} />
                      <code className="text-foreground text-xs font-medium">
                        {e.path}
                      </code>
                      <span className="text-muted-foreground ml-3 min-w-0 flex-1 truncate text-sm">
                        {e.summary}
                      </span>
                      {e.scopes.length > 0 && (
                        <span className="inline-flex gap-1">
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
                        className="text-muted-foreground/40 group-hover:text-foreground ml-2 transition"
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

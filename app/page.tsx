import Link from "next/link";
import { ArrowRight, FolderSync, KeyRound } from "lucide-react";
import { Card, CardBody } from "@/components/Card";
import { listApiSummaries } from "@/lib/specs";
import { apiTheme } from "@/lib/design";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Home() {
  const apis = await listApiSummaries();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="from-foreground to-muted-foreground bg-gradient-to-r bg-clip-text text-2xl font-semibold text-transparent">
          Choisissez une API
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Toutes les APIs Pack Solutions, prêtes à être appelées depuis votre
          navigateur. Pas besoin de connaître Postman — les exemples du
          contrat servent de point de départ.
        </p>
      </header>

      {apis.length === 0 && (
        <Card>
          <CardBody className="flex flex-col items-center gap-5 p-10 text-center sm:p-14">
            <span className="bg-primary text-primary-foreground inline-flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm">
              <FolderSync size={28} strokeWidth={2} />
            </span>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">
                Aucune spec OpenAPI chargée
              </h2>
              <p className="text-muted-foreground mx-auto max-w-md text-sm">
                Cliquez sur l&apos;icône{" "}
                <FolderSync
                  size={12}
                  className="text-foreground inline align-[-1px]"
                  aria-hidden
                />{" "}
                en haut à droite pour synchroniser les specs, ou ajustez le
                chemin source dans{" "}
                <Link
                  href="/settings"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Paramètres
                </Link>
                .
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apis.map((api) => {
          const theme = apiTheme(api.id);
          const Icon = theme.icon;
          const scopeCount = Object.keys(api.scopes).length;
          return (
            <Link
              key={api.id}
              href={`/${api.id}`}
              className={cn(
                "group bg-card relative flex flex-col gap-3 overflow-hidden rounded-xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                theme.border,
                theme.ring,
              )}
            >
              <span
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-0 h-1",
                  theme.bgSoft,
                )}
                aria-hidden
              />
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-md ring-1 ring-inset",
                    theme.bg,
                    theme.text,
                    theme.border,
                  )}
                >
                  <Icon size={20} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {api.title}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    v{api.version}
                  </div>
                </div>
                <ArrowRight
                  size={16}
                  className="text-muted-foreground/40 group-hover:text-foreground ml-auto transition group-hover:translate-x-0.5"
                />
              </div>
              {api.serverUrl && (
                <div className="text-muted-foreground truncate font-mono text-[10px]">
                  {api.serverUrl}
                </div>
              )}
              <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
                <KeyRound size={11} />
                {scopeCount} scope{scopeCount > 1 ? "s" : ""} disponible
                {scopeCount > 1 ? "s" : ""}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

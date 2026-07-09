"use client";

import * as React from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  loadCollectedIds,
  clearCollectedIds,
  COLLECTED_IDS_CHANGED_EVENT,
  type CollectedId,
} from "@/lib/id-collector";
import { listApiSummaries, SPECS_CHANGED_EVENT } from "@/lib/specs";
import { apiTheme } from "@/lib/design";
import { cn } from "@/lib/utils";

// Always-accessible collector of freshly-created resource ids (topbar button →
// right-side panel). Ids are captured in RequestBuilder on a POST that returns
// a Location header; here they are grouped by API and copyable in one click.
export function IdCollector() {
  // apiId → most-recent-first collected ids. Re-read from the cache on change.
  const [groups, setGroups] = React.useState<Record<string, CollectedId[]>>(
    {},
  );
  // apiId → human title, for nicer group headers (falls back to the apiId).
  const [titles, setTitles] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    const sync = () => setGroups({ ...loadCollectedIds() });
    sync();
    window.addEventListener(COLLECTED_IDS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(COLLECTED_IDS_CHANGED_EVENT, sync);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      listApiSummaries().then((list) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const a of list) map[a.id] = a.title;
        setTitles(map);
      });
    };
    load();
    window.addEventListener(SPECS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SPECS_CHANGED_EVENT, load);
    };
  }, []);

  const apiIds = Object.keys(groups).filter((id) => groups[id].length > 0);
  const total = apiIds.reduce((n, id) => n + groups[id].length, 0);

  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Collecteur d'IDs"
              className="relative"
            >
              <KeyRound className="size-4" />
              {total > 0 && (
                <span
                  className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
                  aria-hidden
                >
                  {total}
                </span>
              )}
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Collecteur d&apos;IDs</TooltipContent>
      </Tooltip>

      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {/* pr-10 keeps the header text clear of the absolutely-positioned
            close X (top-4 right-4). "Tout vider" lives in a footer below the
            list (see below) rather than here, to avoid crowding that X. */}
        <SheetHeader className="pr-10">
          <SheetTitle>Collecteur d&apos;IDs</SheetTitle>
          <SheetDescription>
            Les 3 dernières ressources créées par API.
          </SheetDescription>
        </SheetHeader>

        <Separator />

        {apiIds.length === 0 ? (
          <div className="text-muted-foreground flex flex-1 items-center justify-center p-8 text-center text-sm">
            Aucun id collecté pour l&apos;instant. Créez une ressource (POST)
            pour commencer.
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 p-4">
              {apiIds.map((apiId) => (
                <ApiGroup
                  key={apiId}
                  apiId={apiId}
                  title={titles[apiId] ?? apiId}
                  entries={groups[apiId]}
                  onClear={() => clearCollectedIds(apiId)}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {total > 0 && (
          <div className="border-border shrink-0 border-t p-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground w-full text-xs"
              onClick={() => clearCollectedIds()}
            >
              <Trash2 className="size-3" /> Tout vider
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ApiGroup({
  apiId,
  title,
  entries,
  onClear,
}: {
  apiId: string;
  title: string;
  entries: CollectedId[];
  onClear: () => void;
}) {
  const theme = apiTheme(apiId);
  const Icon = theme.icon;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded",
            theme.bg,
            theme.text,
          )}
        >
          <Icon size={13} />
        </span>
        <span className="truncate text-sm font-semibold">{title}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-6 shrink-0"
              aria-label={`Vider ${title}`}
              onClick={onClear}
            >
              <Trash2 className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Vider cette API</TooltipContent>
        </Tooltip>
      </div>
      <ul className="space-y-1.5">
        {entries.map((entry, i) => (
          <IdRow key={`${entry.id}-${entry.createdAt}-${i}`} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function IdRow({ entry }: { entry: CollectedId }) {
  const copy = () =>
    navigator.clipboard.writeText(entry.id).then(
      () => toast.success("ID copié"),
      () => toast.error("Échec de la copie"),
    );
  return (
    <li className="border-border bg-muted/40 flex items-center gap-2 rounded-md border px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground truncate text-[11px]">
          {entry.label}
        </div>
        <div className="truncate font-mono text-xs" title={entry.id}>
          {entry.id}
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* SheetClose closes the panel on copy (the clipboard write + toast
              already fired; the toast renders at body level, so it survives). */}
          <SheetClose asChild>
            <Button
              variant="outline"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Copier l'ID"
              onClick={copy}
            >
              <Copy className="size-3" />
            </Button>
          </SheetClose>
        </TooltipTrigger>
        <TooltipContent side="left">Copier l&apos;ID</TooltipContent>
      </Tooltip>
    </li>
  );
}

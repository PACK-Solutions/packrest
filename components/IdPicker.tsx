"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  COLLECTED_IDS_CHANGED_EVENT,
  extractSeenItems,
  FETCHABLE_ID_LISTS,
  loadCollectedIds,
  loadSeenIds,
  recordSeenIds,
  seenIdsFor,
  type FetchableIdList,
  type IdOrigin,
} from "@/lib/id-collector";
import { callOperation } from "@/lib/operation-fetch";
import { findEndpoint, listApiSummaries, loadSpec } from "@/lib/specs";

// The API of the form the picker sits in, listed first. Provided by
// RequestBuilder; SchemaField has no apiId of its own.
export const IdPickerApiContext = createContext<string | undefined>(undefined);

interface Entry {
  id: string;
  label?: string; // absent when nothing obvious names the resource
  origin?: IdOrigin;
  at: number;
}

interface Group {
  apiId: string;
  operationId?: string; // seen groups only
  source: string;
  entries: Entry[];
}

// A fetchable list and its input belong to each other: product ids offered on
// a `subscriber_id` would be noise, and so would persons on a `product_id`.
function isReservedElsewhere(apiId: string, operationId: string, name?: string): boolean {
  return Object.entries(FETCHABLE_ID_LISTS).some(
    ([field, l]) => field !== name && l.apiId === apiId && l.operationId === operationId,
  );
}

function collectGroups(name?: string): Group[] {
  const groups: Group[] = [];
  for (const [apiId, list] of Object.entries(loadCollectedIds())) {
    const byOperation = new Map<string, Entry[]>();
    for (const e of list) {
      const entries = byOperation.get(e.label) ?? [];
      entries.push({ id: e.id, label: e.name, origin: e.origin, at: e.createdAt });
      byOperation.set(e.label, entries);
    }
    for (const [operation, entries] of byOperation)
      groups.push({ apiId, source: `Créés · ${operation}`, entries });
  }
  for (const list of Object.values(loadSeenIds())) {
    if (!list.length) continue;
    const { apiId, operationId, operationLabel } = list[0];
    if (isReservedElsewhere(apiId, operationId, name)) continue;
    groups.push({
      apiId,
      operationId,
      source: `Vus · ${operationLabel}`,
      entries: list.map((e) => ({ id: e.id, label: e.label, at: e.seenAt })),
    });
  }
  const own = name ? FETCHABLE_ID_LISTS[name] : undefined;
  return own
    ? groups.filter((g) => g.apiId === own.apiId && g.operationId === own.operationId)
    : groups;
}

const relative = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  return relative.format(-Math.round(hours / 24), "day");
}

// Runs the list unfiltered and keeps its items as that operation's seen ids.
// Resolves to an error message, or null on success.
async function fetchIdList(list: FetchableIdList): Promise<string | null> {
  try {
    const [res, doc] = await Promise.all([
      callOperation({ apiId: list.apiId, operationId: list.operationId, method: "GET" }),
      loadSpec(list.apiId),
    ]);
    if (!res) return "Opération introuvable : synchronisez les contrats.";
    if (res.status < 200 || res.status >= 300)
      return `Échec du chargement (HTTP ${res.status}).`;
    const entry = doc ? findEndpoint(doc, list.apiId, list.operationId) : null;
    recordSeenIds(
      {
        apiId: list.apiId,
        operationId: list.operationId,
        operationLabel: entry?.summary?.trim() || entry?.path || list.operationId,
      },
      extractSeenItems(res.body),
      { replace: true },
    );
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// Icon button beside an id input: lists every collected id (created and seen),
// grouped by API then source operation, and hands the picked id to `onPick`.
// The input itself stays free text. For a name in FETCHABLE_ID_LISTS, the
// first opening fetches that list when it was never collected, and a button
// refreshes it.
export default function IdPicker({
  name,
  onPick,
}: {
  name?: string;
  onPick: (id: string) => void;
}) {
  const currentApi = useContext(IdPickerApiContext);
  const list = name ? FETCHABLE_ID_LISTS[name] : undefined;
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const autoFetched = useRef(false);

  const refresh = async () => {
    if (!list) return;
    setFetching(true);
    setFetchError(null);
    setFetchError(await fetchIdList(list));
    setFetching(false);
  };

  useEffect(() => {
    if (!open || !list || autoFetched.current) return;
    autoFetched.current = true;
    if (!seenIdsFor(list.apiId, list.operationId).length) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [open, list]);

  useEffect(() => {
    if (!open) return;
    const sync = () => setGroups(collectGroups(name));
    sync();
    window.addEventListener(COLLECTED_IDS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(COLLECTED_IDS_CHANGED_EVENT, sync);
  }, [open, name]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listApiSummaries().then((list) => {
      if (!cancelled) setTitles(Object.fromEntries(list.map((a) => [a.id, a.title])));
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const title = (apiId: string) => titles[apiId] ?? apiId;
  const ordered = [...groups].sort(
    (a, b) =>
      Number(b.apiId === currentApi) - Number(a.apiId === currentApi) ||
      title(a.apiId).localeCompare(title(b.apiId)),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          // Matches the input's height: h-8 for a path param, h-9 for a body leaf.
          className="h-auto w-9 shrink-0 self-stretch"
          aria-label="Choisir un ID collecté"
          title="Choisir un ID collecté"
        >
          <KeyRound className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        {ordered.length === 0 ? (
          <p className="text-muted-foreground p-4 text-center text-sm">
            {fetching && list
              ? `Chargement des ${list.noun}…`
              : "Aucun id collecté pour l'instant. Les ids apparaissent après une création (POST) ou une liste (GET)."}
          </p>
        ) : (
          <Command>
            <CommandInput placeholder="Rechercher un nom, un id, une opération…" />
            <CommandList className="max-h-80">
              <CommandEmpty>Aucun résultat.</CommandEmpty>
              {ordered.map((g) => (
                <CommandGroup
                  key={`${g.apiId} ${g.operationId ?? ""} ${g.source}`}
                  heading={
                    <>
                      <span className="text-foreground font-semibold">
                        {title(g.apiId)}
                      </span>{" "}
                      · {g.source}
                    </>
                  }
                >
                  {g.entries.map((e) => (
                    <CommandItem
                      key={e.id}
                      // cmdk filters on this; it must also be unique across groups.
                      value={`${e.label ?? ""} ${e.id} ${g.source} ${g.apiId} ${g.operationId ?? ""} ${e.origin ?? ""}`}
                      onSelect={() => {
                        onPick(e.id);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {e.label ?? (
                          <span className="font-mono text-xs">{e.id.slice(0, 8)}</span>
                        )}
                      </span>
                      {e.label && (
                        <span className="text-muted-foreground font-mono text-xs">
                          {e.id.slice(0, 8)}
                        </span>
                      )}
                      {e.origin === "parcours" && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          Parcours
                        </Badge>
                      )}
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {ago(e.at)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
        {list && (
          <div className="border-border flex items-center gap-2 border-t p-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-xs"
              disabled={fetching}
              onClick={refresh}
            >
              {fetching ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              Recharger les {list.noun}
            </Button>
            {fetchError && (
              <span className="text-destructive min-w-0 truncate text-xs" title={fetchError}>
                {fetchError}
              </span>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

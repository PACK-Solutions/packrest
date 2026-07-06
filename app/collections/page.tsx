"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FolderOpen,
  Upload,
  ArrowRight,
  FileJson,
  AlertTriangle,
} from "lucide-react";
import { unzipSync, strFromU8 } from "fflate";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import MethodBadge from "@/components/MethodBadge";
import {
  parseRequestYml,
  parseCollectionScopes,
  candidateApiId,
  brunoUrlToPath,
  bruPathToOpenApi,
  IMPORT_SEED_KEY,
  type BrunoRequest,
  type ImportSeed,
} from "@/lib/bruno";
import { listApis, loadSpec, listEndpoints } from "@/lib/specs";

interface EndpointIndexEntry {
  apiId: string;
  method: string;
  path: string;
  operationId: string;
}

// A request as parsed from the file, before matching. `dirApiId` is the zip's
// top-level directory segment (the export layout is `<apiId>/v1/...`), used to
// scope matching to the originating API.
interface RawRequest {
  id: string;
  folder: string;
  req: BrunoRequest;
  dirApiId?: string;
}

// The imported collection in its persisted (match-free) form. Matches are
// re-derived from the current endpoint index so a rehydrated collection stays
// correct even if specs finished loading after the import.
interface PersistedCollection {
  name: string;
  // Collection-level OAuth2 scopes (from opencollection.yml), used as a
  // fallback when a request has no request-level scopes.
  scopes: string[];
  requests: RawRequest[];
}

type MatchResult =
  | { kind: "matched"; apiId: string; operationId: string }
  | { kind: "ambiguous" }
  | { kind: "none" };

interface MatchedRequest extends RawRequest {
  match: MatchResult;
}

// File names that are collection scaffolding, not requests.
const SKIP_FILES = new Set(["opencollection.yml", "folder.yml", "workspace.yml"]);

// sessionStorage key for the imported collection. Session-scoped so imports
// survive navigation to the builder and back, but stay ephemeral across app
// restarts (nothing is written to the persistent store).
const COLLECTION_KEY = "packrest.collection";

function isRequestEntry(entryPath: string): boolean {
  const base = entryPath.split("/").pop() ?? entryPath;
  if (!/\.ya?ml$/i.test(base)) return false;
  if (SKIP_FILES.has(base)) return false;
  // Environment files live under an environments/ folder.
  if (/(^|\/)environments\//i.test(entryPath)) return false;
  return true;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function persistCollection(c: PersistedCollection | null) {
  try {
    if (c) window.sessionStorage.setItem(COLLECTION_KEY, JSON.stringify(c));
    else window.sessionStorage.removeItem(COLLECTION_KEY);
  } catch {
    /* private mode / quota — fall back to in-memory only */
  }
}

function restoreCollection(): PersistedCollection | null {
  try {
    const raw = window.sessionStorage.getItem(COLLECTION_KEY);
    return raw ? (JSON.parse(raw) as PersistedCollection) : null;
  } catch {
    return null;
  }
}

export default function CollectionsPage() {
  const router = useRouter();
  const [imported, setImported] = useState<PersistedCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<EndpointIndexEntry[]>([]);
  const [indexLoaded, setIndexLoaded] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Restore a previously imported collection so returning from the builder
  // keeps the list (Thread A). Runs once; sessionStorage is client-only.
  useEffect(() => {
    setImported((prev) => prev ?? restoreCollection());
  }, []);

  // Endpoint index for matching imported requests back to operation pages.
  // Built client-side from the loaded specs (method uppercased to match the
  // importer's comparison).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ids = await listApis();
        const idx: EndpointIndexEntry[] = [];
        for (const apiId of ids) {
          const doc = await loadSpec(apiId);
          if (!doc) continue;
          for (const e of listEndpoints(doc, apiId)) {
            idx.push({
              apiId,
              method: e.method.toUpperCase(),
              path: e.path,
              operationId: e.operationId,
            });
          }
        }
        if (!cancelled) setIndex(idx);
      } catch {
        /* matching just stays disabled if the index can't load */
      } finally {
        if (!cancelled) setIndexLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Match a request to an endpoint, preferring the originating API (Thread C).
  // Falls back to a global match; genuinely ambiguous method+path across
  // multiple APIs is surfaced rather than silently resolved to the first.
  const matchEndpoint = useCallback(
    (method: string, url: string, apiHint?: string): MatchResult => {
      const path = bruPathToOpenApi(brunoUrlToPath(url));
      const m = method.toUpperCase();
      const hits = index.filter((e) => e.method === m && e.path === path);
      if (!hits.length) return { kind: "none" };
      if (apiHint) {
        const inApi = hits.find((h) => h.apiId === apiHint);
        if (inApi)
          return {
            kind: "matched",
            apiId: inApi.apiId,
            operationId: inApi.operationId,
          };
      }
      const apis = new Set(hits.map((h) => h.apiId));
      if (apis.size === 1)
        return {
          kind: "matched",
          apiId: hits[0].apiId,
          operationId: hits[0].operationId,
        };
      return { kind: "ambiguous" };
    },
    [index],
  );

  // Derive matches from the current index so rehydrated collections and a
  // late-loading index both resolve correctly (Threads A + C).
  const matched: MatchedRequest[] = useMemo(() => {
    if (!imported) return [];
    return imported.requests.map((r) => ({
      ...r,
      match: matchEndpoint(
        r.req.method,
        r.req.url,
        candidateApiId({ dirApiId: r.dirApiId, tags: r.req.tags }),
      ),
    }));
  }, [imported, matchEndpoint]);

  const loadedApiIds = useMemo(
    () => new Set(index.map((e) => e.apiId)),
    [index],
  );

  const matchedCount = useMemo(
    () => matched.filter((r) => r.match.kind === "matched").length,
    [matched],
  );

  // Originating APIs of unmatched requests that aren't among the loaded specs
  // — the fix is to sync those specs (Thread D).
  const missingApis = useMemo(() => {
    const s = new Set<string>();
    for (const r of matched) {
      if (r.match.kind !== "none") continue;
      const cand = candidateApiId({ dirApiId: r.dirApiId, tags: r.req.tags });
      if (cand && !loadedApiIds.has(cand)) s.add(cand);
    }
    return [...s];
  }, [matched, loadedApiIds]);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const requests: RawRequest[] = [];
      let collectionName = "";
      let collectionScopes: string[] = [];

      if (/\.zip$/i.test(file.name)) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const entries = unzipSync(buf);
        let counter = 0;
        for (const [entryPath, bytes] of Object.entries(entries)) {
          if (entryPath.endsWith("/")) continue;
          const segments = entryPath.split("/").filter(Boolean);
          const base = segments[segments.length - 1];
          // Recover collection-level scopes from the scaffolding (Thread B).
          if (base === "opencollection.yml") {
            const s = parseCollectionScopes(strFromU8(bytes));
            if (s.length) collectionScopes = s;
          }
          if (!collectionName && segments.length > 1) {
            collectionName = segments[0];
          }
          if (!isRequestEntry(entryPath)) continue;
          const req = parseRequestYml(strFromU8(bytes));
          const folder =
            segments.length >= 2 ? segments[segments.length - 2] : "";
          const dirApiId = segments.length > 1 ? segments[0] : undefined;
          requests.push({ id: `req-${counter++}`, folder, req, dirApiId });
        }
      } else {
        const req = parseRequestYml(await file.text());
        requests.push({ id: "req-0", folder: "", req });
      }

      if (!requests.length) {
        throw new Error("Aucune requête Bruno trouvée dans le fichier.");
      }
      requests.sort(
        (a, b) =>
          a.folder.localeCompare(b.folder) ||
          (a.req.seq ?? 0) - (b.req.seq ?? 0),
      );
      const name =
        collectionName ||
        file.name.replace(/\.(zip|ya?ml)$/i, "") ||
        "Collection";
      const coll: PersistedCollection = {
        name,
        scopes: collectionScopes,
        requests,
      };
      setImported(coll);
      persistCollection(coll);
      toast.success("Collection Bruno importée", {
        description: `${requests.length} requête${requests.length > 1 ? "s" : ""}`,
      });
    } catch (e) {
      setError((e as Error).message);
      setImported(null);
      persistCollection(null);
    }
  };

  const openInBuilder = (r: MatchedRequest) => {
    if (r.match.kind !== "matched") return;
    // Request-level scopes win over collection-level (Thread B).
    const scopes = r.req.scopes?.length
      ? r.req.scopes
      : (imported?.scopes ?? []);
    const seed: ImportSeed = {
      apiId: r.match.apiId,
      operationId: r.match.operationId,
      params: Object.fromEntries(
        (r.req.params ?? []).map((p) => [p.name, p.value]),
      ),
      headers: (r.req.headers ?? []).map((h) => ({
        key: h.name,
        value: h.value,
        enabled: !h.disabled,
      })),
      body:
        r.req.body?.type === "json" && r.req.body.data
          ? safeJsonParse(r.req.body.data)
          : undefined,
      scopes: scopes.length ? scopes : undefined,
    };
    try {
      window.sessionStorage.setItem(IMPORT_SEED_KEY, JSON.stringify(seed));
    } catch {
      /* private-mode etc. — the builder just opens without pre-fill */
    }
    router.push(
      `/endpoint?api=${encodeURIComponent(r.match.apiId)}&op=${encodeURIComponent(r.match.operationId)}`,
    );
  };

  const renderInput = () => (
    <input
      ref={fileInput}
      type="file"
      accept=".zip,.yml,.yaml,application/zip"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = "";
      }}
    />
  );

  const groups = useMemo(() => {
    if (!imported) return [];
    const byFolder = new Map<string, MatchedRequest[]>();
    for (const r of matched) {
      const key = r.folder || imported.name;
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(r);
    }
    return [...byFolder.entries()];
  }, [imported, matched]);

  if (!imported) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-lg font-semibold">Import Bruno</h1>
        <Card>
          <CardBody className="flex flex-col items-center gap-5 p-10 text-center sm:p-14">
            <span className="bg-primary text-primary-foreground inline-flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm">
              <FolderOpen size={28} strokeWidth={2} />
            </span>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">
                Importer une collection Bruno
              </h2>
              <p className="text-muted-foreground mx-auto max-w-md text-sm">
                Chargez une collection Bruno (
                <code className="bg-muted rounded px-1 font-mono text-[12px]">
                  .zip
                </code>{" "}
                exportée depuis Bruno, ou un fichier de requête{" "}
                <code className="bg-muted rounded px-1 font-mono text-[12px]">
                  .yml
                </code>
                ). Les requêtes reconnues pourront être ouvertes dans le
                builder, pré-remplies.
              </p>
            </div>
            <Button
              variant="default"
              size="lg"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="size-4" /> Importer un fichier Bruno
            </Button>
            {renderInput()}
            {error && (
              <Alert variant="destructive" className="text-left">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <p className="text-muted-foreground text-[11px]">
              L&apos;import est éphémère : rien n&apos;est enregistré. Pour
              exporter, utilisez « Exporter (Bruno) » sur une API ou une
              requête.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{imported.name}</h1>
        <Badge variant="neutral" className="text-[10px]">
          {imported.requests.length} requête
          {imported.requests.length > 1 ? "s" : ""}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="size-3.5" /> Importer un autre fichier
        </Button>
        {renderInput()}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {indexLoaded && matchedCount === 0 && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>
            {missingApis.length > 0 ? (
              <>
                Aucune requête reconnue. La spec{" "}
                {missingApis.map((a, i) => (
                  <span key={a}>
                    {i > 0 && ", "}
                    <code className="bg-muted rounded px-1 font-mono text-[12px]">
                      {a}
                    </code>
                  </span>
                ))}{" "}
                n&apos;est pas chargée —{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => router.push("/settings")}
                >
                  synchronisez-la dans les Paramètres
                </button>
                , puis réimportez.
              </>
            ) : (
              <>
                Aucun endpoint des specs chargées ne correspond aux requêtes
                importées.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {groups.map(([folder, items]) => (
        <Card key={folder}>
          <CardHeader>
            <FolderOpen className="text-muted-foreground size-3.5" />
            <span className="font-semibold capitalize">{folder}</span>
            <Badge variant="neutral" className="ml-1 text-[10px]">
              {items.length}
            </Badge>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-border/60 divide-y">
              {items.map((r) => (
                <li
                  key={r.id}
                  className="hover:bg-accent/40 flex items-center gap-3 px-3 py-2 transition"
                >
                  <MethodBadge method={r.req.method} />
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                    {r.req.name}
                  </span>
                  <code className="text-muted-foreground hidden truncate text-xs sm:block sm:max-w-[45%]">
                    {r.req.url}
                  </code>
                  {r.match.kind === "matched" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 shrink-0 text-xs"
                      onClick={() => openInBuilder(r)}
                    >
                      Ouvrir <ArrowRight className="size-3" />
                    </Button>
                  ) : r.match.kind === "ambiguous" ? (
                    <span
                      className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1 text-[11px]"
                      title="Cet endpoint existe dans plusieurs APIs chargées ; impossible de déterminer laquelle. Ouvrez-le depuis la liste des APIs."
                    >
                      <AlertTriangle className="size-3" /> ambiguë
                    </span>
                  ) : (
                    <span
                      className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1 text-[11px]"
                      title="Aucun endpoint correspondant dans les specs chargées."
                    >
                      <FileJson className="size-3" /> non reconnue
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

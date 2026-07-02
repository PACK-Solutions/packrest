"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Upload, ArrowRight, FileJson } from "lucide-react";
import { unzipSync, strFromU8 } from "fflate";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import MethodBadge from "@/components/MethodBadge";
import {
  parseRequestYml,
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

interface ImportedRequest {
  id: string;
  folder: string;
  req: BrunoRequest;
  match: { apiId: string; operationId: string } | null;
}

interface ImportedCollection {
  name: string;
  requests: ImportedRequest[];
}

// File names that are collection scaffolding, not requests.
const SKIP_FILES = new Set(["opencollection.yml", "folder.yml", "workspace.yml"]);

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

export default function CollectionsPage() {
  const router = useRouter();
  const [imported, setImported] = useState<ImportedCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<EndpointIndexEntry[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const matchEndpoint = useMemo(() => {
    return (method: string, url: string) => {
      const path = bruPathToOpenApi(brunoUrlToPath(url));
      const m = method.toUpperCase();
      const hit = index.find((e) => e.method === m && e.path === path);
      return hit ? { apiId: hit.apiId, operationId: hit.operationId } : null;
    };
  }, [index]);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const requests: ImportedRequest[] = [];
      let collectionName = "";

      if (/\.zip$/i.test(file.name)) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const entries = unzipSync(buf);
        let counter = 0;
        for (const [entryPath, bytes] of Object.entries(entries)) {
          if (entryPath.endsWith("/")) continue;
          const segments = entryPath.split("/").filter(Boolean);
          if (!collectionName && segments.length > 1) {
            collectionName = segments[0];
          }
          if (!isRequestEntry(entryPath)) continue;
          const req = parseRequestYml(strFromU8(bytes));
          const folder =
            segments.length >= 2 ? segments[segments.length - 2] : "";
          requests.push({
            id: `req-${counter++}`,
            folder,
            req,
            match: matchEndpoint(req.method, req.url),
          });
        }
      } else {
        const req = parseRequestYml(await file.text());
        requests.push({
          id: "req-0",
          folder: "",
          req,
          match: matchEndpoint(req.method, req.url),
        });
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
      setImported({ name, requests });
      toast.success("Collection Bruno importée", {
        description: `${requests.length} requête${requests.length > 1 ? "s" : ""}`,
      });
    } catch (e) {
      setError((e as Error).message);
      setImported(null);
    }
  };

  const openInBuilder = (r: ImportedRequest) => {
    if (!r.match) return;
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
    const byFolder = new Map<string, ImportedRequest[]>();
    for (const r of imported.requests) {
      const key = r.folder || imported.name;
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(r);
    }
    return [...byFolder.entries()];
  }, [imported]);

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
              variant="gradient"
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
                  {r.match ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 shrink-0 text-xs"
                      onClick={() => openInBuilder(r)}
                    >
                      Ouvrir <ArrowRight className="size-3" />
                    </Button>
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

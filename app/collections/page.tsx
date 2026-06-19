"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  Trash2,
  FolderOpen,
  FileJson,
  PencilLine,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import MethodBadge from "@/components/MethodBadge";
import PromptDialog from "@/components/PromptDialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  loadCollections,
  saveCollections,
  newId,
  type SavedCollection,
} from "@/lib/storage";
import { fromPostmanV21, toPostmanV21 } from "@/lib/postman";
import { cn } from "@/lib/utils";

export default function CollectionsPage() {
  const [collections, setCollections] = useState<SavedCollection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Dialog state — single mounted instance per action keeps the markup
  // simple and Radix portal-based, so it overlays the whole app.
  const [renameTarget, setRenameTarget] = useState<SavedCollection | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<SavedCollection | null>(
    null,
  );
  const [deleteRequestTarget, setDeleteRequestTarget] = useState<{
    collectionId: string;
    requestId: string;
    requestName: string;
  } | null>(null);

  useEffect(() => {
    const c = loadCollections();
    setCollections(c);
    if (c.length && !activeId) setActiveId(c[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (next: SavedCollection[]) => {
    setCollections(next);
    saveCollections(next);
  };

  const active = collections.find((c) => c.id === activeId) ?? null;

  const onImportFile = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const imported = fromPostmanV21(json);
      const next = [...collections, { ...imported, id: newId("col") }];
      persist(next);
      setActiveId(next[next.length - 1].id);
      toast.success("Collection importée", { description: imported.name });
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  const onExport = (collection: SavedCollection) => {
    const json = toPostmanV21(collection);
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${collection.name.replace(/\s+/g, "-")}.postman_collection.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const commitDeleteCollection = (id: string) => {
    const next = collections.filter((c) => c.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
    toast.success("Collection supprimée");
  };

  const commitRename = (id: string, name: string) => {
    persist(collections.map((x) => (x.id === id ? { ...x, name } : x)));
    toast.success("Collection renommée", { description: name });
  };

  const commitDeleteRequest = (collectionId: string, requestId: string) => {
    persist(
      collections.map((c) =>
        c.id === collectionId
          ? { ...c, requests: c.requests.filter((r) => r.id !== requestId) }
          : c,
      ),
    );
    toast.success("Requête supprimée");
  };

  const renderImportInput = () => (
    <input
      ref={fileInput}
      type="file"
      accept="application/json,.json"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onImportFile(f);
        e.target.value = "";
      }}
    />
  );

  // Empty state — full-width hero. Much more inviting than a tiny card
  // dwarfed by a huge empty pane to the right.
  if (collections.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-lg font-semibold">Collections</h1>
        <Card>
          <CardBody className="flex flex-col items-center gap-5 p-10 text-center sm:p-14">
            <span className="bg-primary text-primary-foreground inline-flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm">
              <FolderOpen size={28} strokeWidth={2} />
            </span>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">
                Aucune collection pour le moment
              </h2>
              <p className="text-muted-foreground mx-auto max-w-md text-sm">
                Enregistrez une requête depuis n&apos;importe quel endpoint,
                ou importez un fichier{" "}
                <code className="bg-muted rounded px-1 font-mono text-[12px]">
                  .postman_collection.json
                </code>{" "}
                pour démarrer.
              </p>
            </div>
            <Button
              variant="gradient"
              size="lg"
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="size-4" /> Importer un fichier Postman
            </Button>
            {renderImportInput()}
            {importError && (
              <Alert variant="destructive" className="text-left">
                <AlertDescription>{importError}</AlertDescription>
              </Alert>
            )}
            <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <Sparkles className="size-3 text-amber-500 dark:text-amber-400" />
              Astuce : sur un endpoint, cliquez « Enregistrer » pour créer
              une collection en un clic.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Collections</h1>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            onClick={() => fileInput.current?.click()}
            className="justify-start"
          >
            <Upload className="size-3.5" /> Importer un
            .postman_collection.json
          </Button>
          {renderImportInput()}
          {importError && (
            <Alert variant="destructive">
              <AlertDescription>{importError}</AlertDescription>
            </Alert>
          )}
        </div>
        <Card>
          <CardBody className="p-0">
            <ul className="divide-border/60 divide-y">
              {collections.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    className={cn(
                      "hover:bg-accent/60 flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      activeId === c.id &&
                        "bg-accent text-accent-foreground font-semibold",
                    )}
                  >
                    <FolderOpen
                      size={14}
                      className={cn(
                        activeId === c.id
                          ? "text-primary"
                          : "text-muted-foreground",
                      )}
                    />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-muted-foreground text-[10px]">
                      {c.requests.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-3">
        {active ? (
          <Card>
            <CardHeader>
              <FolderOpen className="text-muted-foreground size-3.5" />
              <span className="font-semibold">{active.name}</span>
              <Badge variant="neutral" className="ml-1 text-[10px]">
                {active.requests.length} requête
                {active.requests.length > 1 ? "s" : ""}
              </Badge>
              <div className="ml-auto flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRenameTarget(active)}
                  className="h-7 text-xs"
                >
                  <PencilLine className="size-3" /> Renommer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onExport(active)}
                  className="h-7 text-xs"
                >
                  <Download className="size-3" /> Exporter
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteTarget(active)}
                  className="h-7 text-xs"
                >
                  <Trash2 className="size-3" /> Supprimer
                </Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {active.requests.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-10 text-center">
                  <FileJson className="text-muted-foreground/40 size-8" />
                  <p className="text-muted-foreground text-sm">
                    Cette collection est vide. Enregistrez une requête depuis
                    un endpoint pour la remplir.
                  </p>
                </div>
              ) : (
                <ul className="divide-border/60 divide-y">
                  {active.requests.map((r) => (
                    <li
                      key={r.id}
                      className="hover:bg-accent/40 flex items-center gap-3 px-3 py-2 transition"
                    >
                      <MethodBadge method={r.method} />
                      <code className="text-muted-foreground truncate text-xs">
                        {r.url}
                      </code>
                      <span className="text-foreground ml-3 truncate text-sm">
                        {r.name}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setDeleteRequestTarget({
                            collectionId: active.id,
                            requestId: r.id,
                            requestName: r.name,
                          })
                        }
                        aria-label={`Supprimer la requête ${r.name}`}
                        title="Supprimer cette requête"
                        className="text-destructive hover:text-destructive ml-auto size-7"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody className="flex flex-col items-center gap-3 p-12 text-center">
              <span className="bg-muted text-muted-foreground inline-flex h-12 w-12 items-center justify-center rounded-xl">
                <FolderOpen size={22} strokeWidth={1.75} />
              </span>
              <div className="space-y-1">
                <h3 className="text-foreground text-sm font-semibold">
                  Aucune collection sélectionnée
                </h3>
                <p className="text-muted-foreground max-w-xs text-xs">
                  Choisissez une collection à gauche pour en voir les requêtes
                  enregistrées.
                </p>
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      <PromptDialog
        open={renameTarget !== null}
        title="Renommer la collection"
        description="Choisissez un nouveau nom pour cette collection."
        field1Label="Nom"
        field1DefaultValue={renameTarget?.name ?? ""}
        submitLabel="Renommer"
        onSubmit={(name) => {
          if (renameTarget) commitRename(renameTarget.id, name);
          setRenameTarget(null);
        }}
        onCancel={() => setRenameTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer la collection ?"
        description={
          deleteTarget
            ? `La collection « ${deleteTarget.name} » et ses ${deleteTarget.requests.length} requête(s) seront définitivement supprimées.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        onConfirm={() => {
          if (deleteTarget) commitDeleteCollection(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={deleteRequestTarget !== null}
        title="Supprimer la requête ?"
        description={
          deleteRequestTarget
            ? `« ${deleteRequestTarget.requestName} » sera retirée de la collection.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        onConfirm={() => {
          if (deleteRequestTarget)
            commitDeleteRequest(
              deleteRequestTarget.collectionId,
              deleteRequestTarget.requestId,
            );
          setDeleteRequestTarget(null);
        }}
        onCancel={() => setDeleteRequestTarget(null)}
      />
    </div>
  );
}

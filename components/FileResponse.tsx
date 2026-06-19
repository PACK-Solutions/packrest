"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ProxyFile } from "@/lib/http";

// Renders a file-download response: instead of dumping the raw bytes into the
// body view, we show a compact "file" card with a viewer (opens the browser's
// native PDF/image/text viewer in a new tab) and a download button. Images get
// an inline preview directly in the panel.
export default function FileResponse({ file }: { file: ProxyFile }) {
  const name = file.filename ?? "fichier";
  // The contracts declare `application/octet-stream` as a formal envelope, but
  // the browser only renders a blob in a viewer if it carries a real MIME type
  // (octet-stream forces a download). Infer a viewable type from the filename
  // when the upstream type is generic.
  const viewType = useMemo(
    () => viewableType(file.contentType, name),
    [file.contentType, name],
  );

  // base64 → Blob → object URL. Creation AND revocation must live in the same
  // effect: under React StrictMode (dev) effects run mount → cleanup → mount,
  // so splitting createObjectURL into a useMemo would let the cleanup revoke
  // the only URL before the user ever clicks ("impossible d'afficher la page").
  const [url, setUrl] = useState("");
  useEffect(() => {
    const binary = atob(file.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: viewType });
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file.base64, viewType]);

  const isImage = viewType.startsWith("image/");

  // Open the blob in a new tab via an anchor click. `window.open(blobUrl, …,
  // "noopener")` is silently blocked by Chrome/Firefox — the new top-level
  // context can't resolve a blob URL it didn't create — so the button did
  // nothing. An anchor with target=_blank (and no rel=noopener) works.
  const openViewer = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.click();
  };

  return (
    <div className="space-y-3">
      <div className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-md border p-3">
        <div className="bg-background text-muted-foreground border-border flex size-10 shrink-0 items-center justify-center rounded-md border">
          <FileText className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-foreground truncate font-medium" title={name}>
            {name}
          </div>
          <div className="text-muted-foreground font-mono text-xs">
            {file.contentType} · {formatBytes(file.size)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={openViewer}
            disabled={!url}
          >
            <ExternalLink className="size-3.5" /> Ouvrir la visualiseuse
          </Button>
          <Button asChild size="sm" className="h-8 text-xs">
            <a href={url || undefined} download={name}>
              <Download className="size-3.5" /> Télécharger
            </a>
          </Button>
        </div>
      </div>
      {isImage && url && (
        <div className="border-border bg-muted/40 flex justify-center rounded-md border p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={name}
            className="max-h-[60vh] max-w-full rounded object-contain"
          />
        </div>
      )}
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
};

// Returns a MIME type the browser can render. Keeps a real upstream type, but
// when it's the generic octet-stream (or missing), guesses from the filename
// extension so "Ouvrir" displays the file instead of downloading it.
function viewableType(contentType: string, filename: string): string {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") return ct;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? (contentType || "application/octet-stream");
}

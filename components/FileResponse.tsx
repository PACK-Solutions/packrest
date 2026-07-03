"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Eye, EyeOff, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { saveBytes } from "@/lib/exporter";
import { base64ToBytes } from "@/lib/net";
import { formatFileSize } from "@/lib/utils";
import type { ProxyFile } from "@/lib/http";

// Renders a file-download response: instead of dumping the raw bytes into the
// body view, we show a compact "file" card with an inline viewer and a
// download button. The viewer renders *inside* the current webview — an
// `<img>` for images, an `<iframe>` for PDF/text — because the Tauri webview
// has no notion of a "new tab": the old `<a target="_blank">` trick silently
// did nothing there (WKWebView on macOS / WebView2 on Windows), so PDFs never
// showed at all and the button was dead for images too.
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

  // Decode base64 → bytes once, shared by the inline viewer's blob URL and the
  // download.
  const bytes = useMemo(() => base64ToBytes(file.base64), [file.base64]);

  // bytes → Blob → object URL. Creation AND revocation must live in the same
  // effect: under React StrictMode (dev) effects run mount → cleanup → mount,
  // so splitting createObjectURL into a useMemo would let the cleanup revoke
  // the only URL before the user ever clicks ("impossible d'afficher la page").
  const [url, setUrl] = useState("");
  useEffect(() => {
    const blob = new Blob([bytes as BlobPart], { type: viewType });
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [bytes, viewType]);

  // Save via the native dialog + Rust `write_file` (saveBytes), not the `<a
  // download>` attribute — the latter is unreliable in the Tauri webview
  // (WKWebView ignores it, so the button did nothing). Falls back to a blob
  // anchor outside Tauri.
  const [saving, setSaving] = useState(false);
  const handleDownload = async () => {
    setSaving(true);
    try {
      await saveBytes(name, bytes, downloadFilters(name));
    } catch (e) {
      // saveBytes → invoke("write_file") rejects on a disk/permission error;
      // surface it instead of leaking an unhandled promise rejection.
      toast.error(`Échec de l'enregistrement : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const isImage = viewType.startsWith("image/");
  const canView = isImage || isInlineViewable(viewType);

  // Images preview automatically (as before); other viewable types (PDF, text)
  // open on demand so a large document isn't rendered until asked for.
  const [open, setOpen] = useState(isImage);
  useEffect(() => setOpen(isImage), [isImage, file.base64]);

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
            {file.contentType} · {formatFileSize(file.size)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {canView && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setOpen((o) => !o)}
              disabled={!url}
            >
              {open ? (
                <>
                  <EyeOff className="size-3.5" /> Masquer la visualiseuse
                </>
              ) : (
                <>
                  <Eye className="size-3.5" /> Ouvrir la visualiseuse
                </>
              )}
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={handleDownload}
            disabled={saving}
          >
            <Download className="size-3.5" /> Télécharger
          </Button>
        </div>
      </div>
      {canView && open && url && (
        <div className="border-border bg-muted/40 rounded-md border p-3">
          {isImage ? (
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={name}
                className="max-h-[60vh] max-w-full rounded object-contain"
              />
            </div>
          ) : (
            <iframe
              src={url}
              title={name}
              className="bg-background h-[70vh] w-full rounded border-0"
            />
          )}
        </div>
      )}
    </div>
  );
}

// A save-dialog filter derived from the filename extension, so the native
// dialog pre-selects the right type. Returns undefined when there's no usable
// extension.
function downloadFilters(name: string): { name: string; extensions: string[] }[] | undefined {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  return ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined;
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

// Types the webview can render inline in an <iframe> (images are handled
// separately with <img>). Anything else only offers a download. `text/html` is
// deliberately excluded: rendering an attacker-controlled HTML download from a
// same-origin blob: URL would execute its scripts inside the app's webview
// origin — it stays download-only.
function isInlineViewable(viewType: string): boolean {
  return (
    viewType === "application/pdf" ||
    viewType === "text/plain" ||
    viewType === "text/csv" ||
    viewType === "application/json" ||
    viewType === "application/xml"
  );
}

// Returns a MIME type the browser can render. Keeps a real upstream type, but
// when it's the generic octet-stream (or missing), guesses from the filename
// extension so "Ouvrir" displays the file instead of downloading it.
function viewableType(contentType: string, filename: string): string {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") return ct;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? (contentType || "application/octet-stream");
}

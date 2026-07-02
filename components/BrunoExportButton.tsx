"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// Downloads a Bruno collection (.zip) for an API, generated server-side from
// its OpenAPI spec. Uses fetch + Blob so a server error surfaces as a toast
// instead of navigating away to a JSON error page.
export default function BrunoExportButton({
  apiId,
  title,
}: {
  apiId: string;
  title: string;
}) {
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/bruno/export?api=${encodeURIComponent(apiId)}`,
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error_description?: string };
          if (body.error_description) message = body.error_description;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${apiId}-bruno.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Collection Bruno exportée", { description: title });
    } catch (e) {
      toast.error("Échec de l'export Bruno", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={onExport} disabled={busy}>
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Download className="size-3.5" />
      )}
      Exporter (Bruno)
    </Button>
  );
}

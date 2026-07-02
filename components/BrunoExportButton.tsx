"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { zipSync, strToU8 } from "fflate";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buildBrunoCollection } from "@/lib/bruno-export";
import { saveBytes } from "@/lib/exporter";

// Builds a Bruno collection (.zip) for an API entirely client-side from its
// OpenAPI spec (buildBrunoCollection + fflate), then saves it via a native
// dialog. Formerly this hit the server-side /api/bruno/export route.
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
      const collection = await buildBrunoCollection(apiId);
      if (!collection) throw new Error("Spec introuvable pour cette API.");
      // Zip laid out like ../openapi/bruno/<api>/v1/, mirroring the old route.
      const entries: Record<string, Uint8Array> = {};
      for (const [rel, content] of Object.entries(collection.files)) {
        entries[`${collection.dir}/${rel}`] = strToU8(content);
      }
      const zipped = zipSync(entries);
      const saved = await saveBytes(`${apiId}-bruno.zip`, zipped, [
        { name: "Archive Bruno", extensions: ["zip"] },
      ]);
      if (saved) toast.success("Collection Bruno exportée", { description: title });
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

"use client";

import { useState } from "react";
import { Loader2, Sheet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { saveBytes } from "@/lib/exporter";
import { buildXlsx, flattenToRows, type ExportMeta } from "@/lib/xlsx";

// Exports the current (structured) response body to a real .xlsx workbook,
// built client-side and saved through the shared save flow. Mirrors
// BrunoExportButton's busy-state + toast UX.
export default function ResponseExportButton({
  body,
  defaultName,
  meta,
  disabled,
}: {
  body: unknown;
  defaultName: string;
  meta?: ExportMeta;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const bytes = buildXlsx(flattenToRows(body), meta);
      const saved = await saveBytes(`${defaultName}.xlsx`, bytes, [
        { name: "Classeur Excel", extensions: ["xlsx"] },
      ]);
      if (saved) toast.success("Réponse exportée en Excel");
    } catch (e) {
      toast.error("Échec de l'export Excel", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      onClick={onExport}
      disabled={disabled || busy}
    >
      {busy ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Sheet className="size-3" />
      )}
      Exporter (Excel)
    </Button>
  );
}

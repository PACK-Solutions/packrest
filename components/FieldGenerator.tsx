"use client";

import * as React from "react";
import { Copy, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FIELD_GENERATORS, generateAll } from "@/lib/fake-fields";

// Topbar generator of fake-but-valid sample field values (IBAN, N° de sécurité
// sociale, SIREN/SIRET, téléphone, …). Fresh values are minted when the popover
// opens; each is copyable and individually re-rollable. Same DropdownMenu-as-
// popover shell as the UUID generator.
export function FieldGenerator() {
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});

  const copy = (label: string, value: string) => {
    // navigator.clipboard is undefined in a non-secure/restricted webview;
    // guard so the button shows an error toast instead of throwing.
    const done = navigator.clipboard?.writeText(value);
    if (!done) {
      toast.error("Échec de la copie");
      return;
    }
    done.then(
      () => toast.success(`${label} copié`),
      () => toast.error("Échec de la copie"),
    );
    setOpen(false); // close the tool once a value is copied
  };

  const regenerate = (key: string, gen: () => string) =>
    setValues((prev) => ({ ...prev, [key]: gen() }));

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValues(generateAll());
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Générateur de champs">
              <Sparkles className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Générateur de champs</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-96 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted-foreground text-[11px] font-medium">
            Valeurs d&apos;exemple (fictives)
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={() => setValues(generateAll())}
          >
            <RefreshCw className="size-3" /> Tout régénérer
          </Button>
        </div>
        <div className="max-h-[70vh] space-y-2 overflow-y-auto">
          {FIELD_GENERATORS.map((f) => {
            const value = values[f.key] ?? "";
            return (
              <div key={f.key}>
                <div className="text-muted-foreground mb-0.5 text-[11px]">
                  {f.label}
                </div>
                <div className="flex items-center gap-1.5">
                  <div
                    className="border-border bg-muted/40 min-w-0 flex-1 overflow-x-auto rounded-md border px-2.5 py-1.5 font-mono text-xs whitespace-nowrap select-all"
                    title={value}
                  >
                    {value}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={`Régénérer ${f.label}`}
                    title="Régénérer"
                    onClick={() => regenerate(f.key, f.generate)}
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={`Copier ${f.label}`}
                    title="Copier"
                    onClick={() => copy(f.label, value)}
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

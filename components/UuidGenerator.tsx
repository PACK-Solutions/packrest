"use client";

import * as React from "react";
import { Copy, Dices, RefreshCw } from "lucide-react";
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

// Topbar UUID generator: a v4 UUID is minted (crypto.randomUUID) each time the
// popover opens, shown in a mono field, and copyable in one click. Uses the
// DropdownMenu as a popover shell (no @radix-ui/react-popover in the project).
export function UuidGenerator() {
  const [open, setOpen] = React.useState(false);
  const [uuid, setUuid] = React.useState("");

  // Copying also closes the popover (the clipboard write + toast already fired;
  // the toast renders at body level, so it survives the close).
  const copy = () => {
    navigator.clipboard.writeText(uuid).then(
      () => toast.success("UUID copié"),
      () => toast.error("Échec de la copie"),
    );
    setOpen(false);
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setUuid(crypto.randomUUID());
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Générateur d'UUID"
            >
              <Dices className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Générateur d&apos;UUID</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-80 p-3">
        <div className="text-muted-foreground mb-1.5 text-[11px] font-medium">
          UUID v4
        </div>
        <div
          className="border-border bg-muted/40 mb-2.5 overflow-x-auto rounded-md border px-2.5 py-2 font-mono text-xs whitespace-nowrap select-all"
          title={uuid}
        >
          {uuid}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="flex-1" onClick={copy}>
            <Copy className="size-3" /> Copier
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUuid(crypto.randomUUID())}
          >
            <RefreshCw className="size-3" /> Régénérer
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

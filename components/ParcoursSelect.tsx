"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { Card, CardHeader, CardBody } from "@/components/Card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SelectOption } from "@/lib/parcours";

// Picker shown after a catalogue/list step runs. Single-select rows confirm on
// click; multi-select rows toggle and are confirmed together with a button.
// The chosen id(s) are pushed into the parcours context (pre-filling later
// steps — e.g. the premium's `allocations`).
export default function ParcoursSelect({
  title,
  options,
  multiSelect,
  selectedIds,
  onConfirm,
}: {
  title: string;
  options: SelectOption[];
  multiSelect?: boolean;
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selectedIds));

  const toggle = (id: string) => {
    if (!multiSelect) {
      onConfirm([id]);
      return;
    }
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card tone="success">
      <CardHeader tone="success">
        <span className="font-semibold">{title}</span>
        <span className="text-muted-foreground ml-2 text-xs">
          {options.length} élément{options.length > 1 ? "s" : ""}
          {multiSelect && ` · ${picked.size} sélectionné${picked.size > 1 ? "s" : ""}`}
        </span>
      </CardHeader>
      <CardBody className="space-y-2 p-2">
        {options.length === 0 ? (
          <p className="text-muted-foreground p-2 text-sm">
            Aucun élément sélectionnable dans la réponse — copiez l&apos;id
            manuellement depuis le panneau de réponse.
          </p>
        ) : (
          <>
            <ul className="max-h-80 space-y-1 overflow-y-auto">
              {options.map((o) => {
                const active = picked.has(o.id);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => toggle(o.id)}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500/70 dark:bg-emerald-900/30"
                          : "border-border hover:bg-muted/60",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                          multiSelect ? "rounded" : "rounded-full",
                          active
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-muted-foreground/40",
                        )}
                      >
                        {active && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {o.label}
                        </span>
                        {o.detail && (
                          <span className="text-muted-foreground block truncate text-xs">
                            {o.detail}
                          </span>
                        )}
                        <span className="text-muted-foreground block truncate font-mono text-[11px]">
                          {o.id}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {multiSelect && (
              <Button
                variant="success"
                size="sm"
                className="w-full"
                disabled={picked.size === 0}
                onClick={() => onConfirm([...picked])}
              >
                Valider la sélection ({picked.size})
              </Button>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

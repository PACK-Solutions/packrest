"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Eraser } from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardBody } from "@/components/Card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONTEXT_FIELDS, type ContextKey, type ContextValues } from "@/lib/parcours";

function truncate(v: string, max = 16): string {
  return v.length > max ? v.slice(0, max) + "…" : v;
}

// The running bag of values chained between parcours steps. Collapsed by
// default (just chips of the filled values) to keep the screen quiet; expand
// to edit any value — captured ones fill in as steps run, catalogue picks are
// typed.
export default function ParcoursContextPanel({
  values,
  onChange,
  onReset,
}: {
  values: ContextValues;
  onChange: (key: ContextKey, value: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const filled = CONTEXT_FIELDS.filter((f) => (values[f.key] ?? "") !== "");

  const copy = (value: string) => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success("Copié"))
      .catch(() => toast.error("Copie impossible"));
  };

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 font-semibold"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          Contexte
          <span className="text-muted-foreground text-xs font-normal">
            ({filled.length} renseignée{filled.length > 1 ? "s" : ""})
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          onClick={onReset}
          title="Réinitialiser le parcours (valeurs + progression)"
        >
          <Eraser className="size-3.5" /> Réinitialiser
        </Button>
      </CardHeader>

      {!open
        ? filled.length > 0 && (
            <CardBody className="p-2">
              <div className="flex flex-wrap gap-1">
                {filled.map((f) => (
                  <span
                    key={f.key}
                    className="bg-muted rounded px-1.5 py-0.5 font-mono text-[11px]"
                    title={`${f.key} = ${values[f.key]}`}
                  >
                    {f.key}=
                    <span className="text-muted-foreground">
                      {truncate(values[f.key] ?? "")}
                    </span>
                  </span>
                ))}
              </div>
            </CardBody>
          )
        : (
          <CardBody className="space-y-2 p-3">
            {CONTEXT_FIELDS.map((f) => {
              const value = values[f.key] ?? "";
              return (
                <div key={f.key} className="flex items-center gap-1.5">
                  <label
                    htmlFor={`ctx-${f.key}`}
                    className="text-muted-foreground w-44 shrink-0 truncate font-mono text-[11px]"
                    title={f.label}
                  >
                    {f.label}
                    {f.manual && (
                      <span className="text-amber-600 dark:text-amber-400"> *</span>
                    )}
                  </label>
                  <Input
                    id={`ctx-${f.key}`}
                    value={value}
                    onChange={(e) => onChange(f.key, e.target.value)}
                    placeholder="—"
                    className="h-7 font-mono text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    disabled={!value}
                    onClick={() => copy(value)}
                    aria-label={`Copier ${f.label}`}
                    title="Copier"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              );
            })}
            <p className="text-muted-foreground pt-1 text-[11px]">
              <span className="text-amber-600 dark:text-amber-400">*</span> à
              renseigner manuellement (choisi dans le catalogue des produits) ;
              les autres valeurs se remplissent au fil des étapes.
            </p>
          </CardBody>
        )}
    </Card>
  );
}

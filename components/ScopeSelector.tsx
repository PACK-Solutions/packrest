"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "@/lib/design";

interface Props {
  available: Record<string, string>;
  selected: string[];
  onChange: (next: string[]) => void;
  // Operation-required scopes — shown first and flagged so the user knows the
  // minimum. Pre-selected by the caller; kept toggleable.
  required?: string[];
  className?: string;
}

// A single checkable scope row: checkbox indicator + technical name + the
// contract's plain-language description (always visible, no hover needed).
function ScopeRow({
  name,
  description,
  checked,
  onToggle,
  isRequired,
}: {
  name: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
  isRequired: boolean;
}) {
  // Required-but-unchecked reads as a gentle warning — the user removed a scope
  // the operation needs.
  const warn = isRequired && !checked;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        checked
          ? "border-primary/50 bg-primary/5 hover:bg-primary/10"
          : warn
            ? cn(
                TONE_CLASSES.warn.soft,
                TONE_CLASSES.warn.border,
                "hover:bg-amber-100 dark:hover:bg-amber-900/40",
              )
            : "border-input bg-background hover:bg-accent",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-background",
        )}
        aria-hidden
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-semibold">{name}</span>
          {isRequired && (
            <span
              className={cn(
                "rounded px-1 text-[9px] font-semibold uppercase tracking-wider",
                TONE_CLASSES.warn.soft,
                TONE_CLASSES.warn.text,
              )}
            >
              requis
            </span>
          )}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs">
          {description || (
            <span className="italic">Pas de description dans le contrat.</span>
          )}
        </span>
      </span>
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground px-0.5 text-[10px] font-semibold uppercase tracking-wider">
      {children}
    </div>
  );
}

export default function ScopeSelector({
  available,
  selected,
  onChange,
  required = [],
  className = "",
}: Props) {
  const requiredSet = useMemo(() => new Set(required), [required]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Required scopes first (in declared order), then the rest. A required scope
  // missing from the flow's `scopes` map still shows (description undefined).
  const { requiredRows, optionalRows } = useMemo(() => {
    const req = required.map((name) => ({
      name,
      description: available[name],
    }));
    const opt = Object.entries(available)
      .filter(([name]) => !requiredSet.has(name))
      .map(([name, description]) => ({ name, description }));
    return { requiredRows: req, optionalRows: opt };
  }, [available, required, requiredSet]);

  if (requiredRows.length === 0 && optionalRows.length === 0) {
    return (
      <p className={cn("text-muted-foreground text-xs", className)}>
        Pas de scope déclaré dans le contrat.
      </p>
    );
  }

  const toggle = (name: string) => {
    if (selectedSet.has(name)) onChange(selected.filter((s) => s !== name));
    else onChange([...selected, name]);
  };

  return (
    <div className={cn("space-y-3", className)}>
      {requiredRows.length > 0 && (
        <div className="space-y-1.5">
          <GroupLabel>Requis</GroupLabel>
          {requiredRows.map(({ name, description }) => (
            <ScopeRow
              key={name}
              name={name}
              description={description}
              checked={selectedSet.has(name)}
              onToggle={() => toggle(name)}
              isRequired
            />
          ))}
        </div>
      )}
      {optionalRows.length > 0 && (
        <div className="space-y-1.5">
          <GroupLabel>Optionnels</GroupLabel>
          {optionalRows.map(({ name, description }) => (
            <ScopeRow
              key={name}
              name={name}
              description={description}
              checked={selectedSet.has(name)}
              onToggle={() => toggle(name)}
              isRequired={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

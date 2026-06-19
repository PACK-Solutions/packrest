"use client";

import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "@/lib/design";

interface Props {
  available: Record<string, string>;
  selected: string[];
  onChange: (next: string[]) => void;
  // Operation-required scopes — highlighted so the user knows the minimum.
  required?: string[];
  className?: string;
}

export default function ScopeSelector({
  available,
  selected,
  onChange,
  required = [],
  className = "",
}: Props) {
  const entries = useMemo(() => Object.entries(available), [available]);
  const requiredSet = useMemo(() => new Set(required), [required]);
  if (entries.length === 0) {
    return (
      <p className={cn("text-muted-foreground text-xs", className)}>
        Pas de scope déclaré dans le contrat.
      </p>
    );
  }
  const toggle = (name: string) => {
    if (selected.includes(name)) onChange(selected.filter((s) => s !== name));
    else onChange([...selected, name]);
  };
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {entries.map(([name, description]) => {
        const active = selected.includes(name);
        const req = requiredSet.has(name);
        return (
          <Tooltip key={name}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => toggle(name)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    : req
                      ? cn(
                          TONE_CLASSES.warn.softStrong,
                          TONE_CLASSES.warn.border,
                          TONE_CLASSES.warn.text,
                          "hover:bg-amber-200 dark:hover:bg-amber-900/60",
                        )
                      : "border-input bg-background text-foreground hover:bg-accent",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    active
                      ? "bg-primary-foreground"
                      : req
                        ? TONE_CLASSES.warn.dot
                        : "bg-muted-foreground",
                  )}
                  aria-hidden
                />
                {name}
                {req && !active && (
                  <span className="ml-0.5 text-[9px] font-semibold uppercase tracking-wider opacity-70">
                    requis
                  </span>
                )}
              </button>
            </TooltipTrigger>
            {description && (
              <TooltipContent className="max-w-xs text-xs">
                {description}
              </TooltipContent>
            )}
          </Tooltip>
        );
      })}
    </div>
  );
}

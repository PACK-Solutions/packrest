"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FieldOption } from "@/components/FieldOptionsContext";
import { cn } from "@/lib/utils";

// Searchable single-select over a supplied option list, used by SchemaField for
// string leaves that carry externally-fetched options (e.g. a product's funds).
// Emits the chosen option's `value`; clearing emits "" when required (so the key
// is still present) or `undefined` otherwise (so the key is dropped from JSON) —
// matching the plain-string leaf's own onChange contract.
export default function FieldCombobox({
  options,
  value,
  onChange,
  required,
}: {
  options: FieldOption[];
  value: unknown;
  onChange: (next: string | undefined) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = value === null || value === undefined ? "" : String(value);
  const selected = options.find((o) => o.value === current);

  // A value that isn't among the loaded options (a seeded id, or one on a page
  // the option fetch didn't return, or one still loading) is NOT cleared — that
  // would silently erase the user's input. It's shown as-is in the trigger and
  // stays in the payload; the user can open the list to change it.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-required={required || undefined}
          className={cn(
            "w-full justify-between font-normal",
            !selected && current === "" && "text-muted-foreground",
          )}
        >
          <span className="truncate">
            {selected ? selected.label : current !== "" ? current : "Sélectionner…"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Rechercher…" />
          <CommandList>
            <CommandEmpty>Aucun résultat.</CommandEmpty>
            <CommandGroup>
              {!required && current !== "" && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  Effacer la sélection
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  // Filter on the human label (+ id), not just the uuid value.
                  value={`${o.label} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      o.value === current ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { SavedHeader } from "@/lib/storage";

interface Props {
  value: SavedHeader[];
  onChange: (next: SavedHeader[]) => void;
  // Headers that are auto-injected (Authorization, Content-Type) — shown
  // but greyed out so the user understands they don't need to set them.
  managed?: SavedHeader[];
}

export default function HeaderEditor({ value, onChange, managed = [] }: Props) {
  const update = (idx: number, patch: Partial<SavedHeader>) => {
    onChange(value.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  };
  const remove = (idx: number) =>
    onChange(value.filter((_, i) => i !== idx));
  const add = () =>
    onChange([...value, { key: "", value: "", enabled: true }]);

  return (
    <div className="space-y-1.5">
      {managed.map((h) => (
        <div
          key={`managed-${h.key}`}
          className="bg-muted/60 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
        >
          <span className="text-muted-foreground font-mono font-semibold line-through opacity-60">
            géré
          </span>
          <span className="font-mono">{h.key}</span>
          <span className="text-muted-foreground ml-auto truncate font-mono">
            {h.value}
          </span>
        </div>
      ))}
      {value.map((h, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Checkbox
            checked={h.enabled !== false}
            onCheckedChange={(c) => update(idx, { enabled: Boolean(c) })}
          />
          <Input
            value={h.key}
            placeholder="Nom"
            onChange={(e) => update(idx, { key: e.target.value })}
            className="h-8 w-1/3 font-mono text-xs"
          />
          <Input
            value={h.value}
            placeholder="Valeur"
            onChange={(e) => update(idx, { value: e.target.value })}
            className="h-8 flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(idx)}
            aria-label={
              h.key ? `Supprimer l'en-tête ${h.key}` : "Supprimer cette ligne"
            }
            title="Supprimer cet en-tête"
            className="text-destructive hover:text-destructive size-8"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        className="border-dashed text-xs"
      >
        <Plus className="size-3" /> Ajouter un en-tête
      </Button>
    </div>
  );
}

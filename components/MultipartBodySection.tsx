"use client";

import { Upload, X } from "lucide-react";

import SchemaField from "@/components/SchemaField";
import Field from "@/components/Field";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn, formatFileSize } from "@/lib/utils";
import type { JsonSchema } from "@/lib/types";
import { partitionRequiredFirst } from "@/lib/schema-normalize";

interface Props {
  schema: JsonSchema;
  // Per-property `encoding` from the multipart media type (drives `accept`).
  encoding?: Record<string, { contentType?: string }>;
  // Non-file (metadata) fields, held as a plain object.
  value: unknown;
  onChange: (next: unknown) => void;
  // Selected files, keyed by property name.
  files: Record<string, File | null>;
  onFilesChange: (next: Record<string, File | null>) => void;
}

// A `type: string, format: binary` property is rendered as a file picker
// rather than a text box.
function isBinary(schema: JsonSchema): boolean {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  return type === "string" && schema.format === "binary";
}

// A multipart schema often carries a constraint-only `anyOf` (e.g. "at least
// one of contract_id / person_id") alongside its `properties`. We render the
// properties directly (SchemaField's oneOf/anyOf handling would misfire on
// these bare `{ required: [...] }` variants) and surface the constraint as a
// hint.
function anyOfRequiredNames(schema: JsonSchema): string[] {
  if (!schema.anyOf?.length) return [];
  const names = new Set<string>();
  for (const variant of schema.anyOf) {
    for (const r of variant.required ?? []) names.add(r);
  }
  return [...names];
}

export default function MultipartBodySection({
  schema,
  encoding,
  value,
  onChange,
  files,
  onFilesChange,
}: Props) {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const obj = (
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>;
  const owners = anyOfRequiredNames(schema);
  // Required fields first, then optional — shared with the JSON body form.
  const entries = partitionRequiredFirst(
    Object.entries(props).filter(([, sub]) => !sub.readOnly),
    required,
  );

  return (
    <div className="space-y-3">
      {entries.map(([name, sub]) => {
        if (isBinary(sub)) {
          const accept = encoding?.[name]?.contentType
            ?.split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .join(",");
          const picked = files[name] ?? null;
          return (
            <Field
              key={name}
              label={sub.title ?? name}
              hint={sub.description}
              required={required.has(name)}
            >
              <div className="flex items-center gap-2">
                {/* Native <input type=file> renders an English, unstyled
                    "Choose File / No file chosen" control. We hide it and drive
                    it from a French, styled label instead. */}
                <label
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "h-8 shrink-0 cursor-pointer text-xs",
                  )}
                >
                  <Upload className="size-3.5" />
                  {picked ? "Changer de fichier" : "Choisir un fichier"}
                  <input
                    type="file"
                    accept={accept || undefined}
                    className="sr-only"
                    // Reset so re-picking the same file still fires onChange.
                    onClick={(e) => {
                      (e.currentTarget as HTMLInputElement).value = "";
                    }}
                    onChange={(e) =>
                      onFilesChange({
                        ...files,
                        [name]: e.target.files?.[0] ?? null,
                      })
                    }
                  />
                </label>
                <span
                  className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
                  title={picked?.name}
                >
                  {picked
                    ? `${picked.name} — ${formatFileSize(picked.size)}`
                    : "Aucun fichier sélectionné"}
                </span>
                {picked && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-7 shrink-0"
                    aria-label="Retirer le fichier"
                    onClick={() => onFilesChange({ ...files, [name]: null })}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            </Field>
          );
        }
        return (
          <SchemaField
            key={name}
            schema={sub}
            value={obj[name]}
            onChange={(next) => onChange({ ...obj, [name]: next })}
            name={name}
            required={required.has(name)}
          />
        );
      })}
      {owners.length > 0 && (
        <p className="text-muted-foreground text-[11px]">
          Au moins un de : {owners.join(" / ")}
        </p>
      )}
    </div>
  );
}

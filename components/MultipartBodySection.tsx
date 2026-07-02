"use client";

import SchemaField from "@/components/SchemaField";
import Field from "@/components/Field";
import { Input } from "@/components/ui/input";
import type { JsonSchema } from "@/lib/types";

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
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
  const entries = Object.entries(props).filter(([, sub]) => !sub.readOnly);

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
              <Input
                type="file"
                accept={accept || undefined}
                onChange={(e) =>
                  onFilesChange({
                    ...files,
                    [name]: e.target.files?.[0] ?? null,
                  })
                }
              />
              {picked && (
                <p className="text-muted-foreground mt-1 text-[11px]">
                  {picked.name} — {formatBytes(picked.size)}
                </p>
              )}
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

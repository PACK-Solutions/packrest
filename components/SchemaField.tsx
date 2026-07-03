"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Field, { FieldHint } from "@/components/Field";
import type { JsonSchema } from "@/lib/types";
import { defaultFromSchema } from "@/lib/example-extractor";
import { cn } from "@/lib/utils";

interface Props {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  // Property name and required flag come from the parent object — only
  // forwarded for label rendering.
  name?: string;
  required?: boolean;
}

// Recursive renderer. Each subschema picks a control:
//   • string + enum  → select
//   • string         → input (type tailored by format)
//   • integer/number → number input
//   • boolean        → checkbox
//   • array          → repeatable list, recurses on items
//   • object         → grouped fieldset
//   • oneOf/anyOf    → branch picker + recursion on chosen branch
//   • allOf          → merged via defaultFromSchema; rendered as a single
//                       object by combining properties.
//
// readOnly fields are dropped (Spectral guarantees Create/Update schemas
// don't carry readOnly).
export default function SchemaField({
  schema,
  value,
  onChange,
  name,
  required,
}: Props) {
  const effective = useMemo(() => mergeAllOf(schema), [schema]);
  const label = effective.title ?? name ?? "";
  const hint = effective.description;

  // const: render as a read-only label
  if (effective.const !== undefined) {
    return (
      <Field label={label} hint={hint} required={required}>
        <Input
          value={String(effective.const)}
          readOnly
          className="bg-muted text-muted-foreground"
        />
      </Field>
    );
  }

  // oneOf/anyOf: branch selector
  const variants = effective.oneOf ?? effective.anyOf;
  if (variants?.length) {
    return (
      <OneOfField
        variants={variants}
        value={value}
        onChange={onChange}
        label={label}
        hint={hint}
        required={required}
        discriminator={effective.discriminator?.propertyName}
      />
    );
  }

  // enum
  if (effective.enum?.length) {
    const stringEnum = effective.enum.map((e) => String(e));
    const current =
      value === undefined || value === null ? "" : String(value);
    return (
      <Field label={label} hint={hint} required={required}>
        <Select
          value={current}
          onValueChange={(v) => onChange(coerceString(v, effective))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {stringEnum.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  // Free-form key-value map (object with `additionalProperties` and no fixed
  // `properties`, e.g. a `metadata` bag). ObjectField would render an empty
  // fieldset — the user reported "nowhere to enter metadata" — so we render a
  // dedicated add/remove row editor instead.
  if (isMapSchema(effective)) {
    return (
      <MapField
        schema={effective}
        value={value}
        onChange={onChange}
        label={label}
        hint={hint}
        required={required}
      />
    );
  }

  const type = Array.isArray(effective.type) ? effective.type[0] : effective.type;

  switch (type) {
    case "boolean":
      return (
        <Field label={label} hint={hint} required={required}>
          <Checkbox
            checked={!!value}
            onCheckedChange={(c) => onChange(Boolean(c))}
          />
        </Field>
      );
    case "integer":
    case "number":
      return (
        <Field label={label} hint={hint} required={required}>
          <Input
            type="number"
            value={value === null || value === undefined ? "" : Number(value)}
            min={effective.minimum}
            max={effective.maximum}
            step={effective.multipleOf ?? (type === "integer" ? 1 : "any")}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                onChange(null);
                return;
              }
              const n = type === "integer" ? parseInt(raw, 10) : parseFloat(raw);
              onChange(Number.isNaN(n) ? null : n);
            }}
          />
        </Field>
      );
    case "array":
      return (
        <ArrayField
          schema={effective}
          value={value}
          onChange={onChange}
          label={label}
          hint={hint}
          required={required}
        />
      );
    case "object":
      return (
        <ObjectField
          schema={effective}
          value={value}
          onChange={onChange}
          label={label}
          hint={hint}
        />
      );
    case "null":
      return null;
    case "string":
    default:
      return (
        <Field label={label} hint={hint} required={required}>
          <Input
            type={inputTypeForFormat(effective.format)}
            value={value === null || value === undefined ? "" : String(value)}
            minLength={effective.minLength}
            maxLength={effective.maxLength}
            pattern={effective.pattern}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
  }
}

function ObjectField({
  schema,
  value,
  onChange,
  label,
  hint,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  label?: string;
  hint?: string;
}) {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const obj = (value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}) as Record<string, unknown>;
  const visible = Object.entries(props).filter(([, sub]) => !sub.readOnly);
  return (
    <fieldset className="bg-muted/30 space-y-3 rounded-md border p-3">
      {label && (
        <legend className="text-foreground px-1 text-xs font-semibold">
          {label}
        </legend>
      )}
      <div className="-mt-1">
        <FieldHint hint={hint} />
      </div>
      {visible.map(([propName, sub]) => (
        <SchemaField
          key={propName}
          schema={sub}
          value={obj[propName]}
          onChange={(next) => onChange({ ...obj, [propName]: next })}
          name={propName}
          required={required.has(propName)}
        />
      ))}
    </fieldset>
  );
}

function ArrayField({
  schema,
  value,
  onChange,
  label,
  hint,
  required,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  label?: string;
  hint?: string;
  required?: boolean;
}) {
  const items = Array.isArray(value) ? value : [];
  const itemSchema = schema.items ?? {};
  return (
    <Field label={label ?? ""} hint={hint} required={required}>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div
            key={idx}
            className="bg-card flex items-start gap-2 rounded-md border p-2"
          >
            <div className="flex-1">
              <SchemaField
                schema={itemSchema}
                value={item}
                onChange={(next) => {
                  const copy = [...items];
                  copy[idx] = next;
                  onChange(copy);
                }}
                name={`#${idx}`}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              aria-label={`Supprimer l'élément ${idx}`}
              className="text-destructive hover:text-destructive mt-1 size-7"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, defaultFromSchema(itemSchema)])}
          className="border-dashed text-xs"
        >
          <Plus className="size-3" /> Ajouter
        </Button>
      </div>
    </Field>
  );
}

interface MapRow {
  id: number;
  key: string;
  val: unknown;
}

function objectToRows(value: unknown): MapRow[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(
    ([key, val], i) => ({ id: i, key, val }),
  );
}

// Editor for a free-form key-value map (object with `additionalProperties`).
// Rows are held in local state so a half-typed / empty key doesn't destroy the
// object representation mid-edit; the parent object is rebuilt from the rows on
// every change (blank keys skipped). Duplicate keys are flagged inline — a JS
// object can't hold them, so the emitted object keeps the last (documented).
function MapField({
  schema,
  value,
  onChange,
  label,
  hint,
  required,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  label: string;
  hint?: string;
  required?: boolean;
}) {
  const valueSchema: JsonSchema =
    schema.additionalProperties && typeof schema.additionalProperties === "object"
      ? schema.additionalProperties
      : {};
  const keyMax = schema.propertyNames?.maxLength;
  const maxEntries = schema.maxProperties;

  const [rows, setRows] = useState<MapRow[]>(() => objectToRows(value));
  const nextId = useRef(rows.length);
  // Tracks the object we last emitted, so we can tell an external value change
  // (import seed, oneOf variant switch, array reorder) apart from our own
  // round-trip. Only external changes resync the rows.
  const lastEmitted = useRef<unknown>(value);
  useEffect(() => {
    if (value !== lastEmitted.current) {
      const next = objectToRows(value);
      nextId.current = next.length;
      setRows(next);
      lastEmitted.current = value;
    }
  }, [value]);

  const commit = (next: MapRow[]) => {
    setRows(next);
    const obj: Record<string, unknown> = {};
    for (const r of next) {
      if (r.key.trim() === "") continue;
      obj[r.key] = r.val;
    }
    lastEmitted.current = obj;
    onChange(obj);
  };

  const atMax = maxEntries != null && rows.length >= maxEntries;
  const keyCounts = new Map<string, number>();
  for (const r of rows) {
    const k = r.key.trim();
    if (k) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  }
  const hasDuplicate = [...keyCounts.values()].some((c) => c > 1);

  return (
    <Field label={label} hint={hint} required={required}>
      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="text-muted-foreground text-xs">Aucune entrée.</p>
        )}
        {rows.map((r, i) => {
          const dup = r.key.trim() !== "" && (keyCounts.get(r.key.trim()) ?? 0) > 1;
          return (
            <div key={r.id} className="flex items-start gap-2">
              <Input
                value={r.key}
                placeholder="clé"
                maxLength={keyMax}
                aria-label={`Clé de l'entrée ${i + 1}`}
                aria-invalid={dup}
                onChange={(e) =>
                  commit(
                    rows.map((x) =>
                      x.id === r.id ? { ...x, key: e.target.value } : x,
                    ),
                  )
                }
                className={cn(
                  "w-1/3 font-mono text-xs",
                  dup && "border-destructive focus-visible:ring-destructive",
                )}
              />
              <div className="flex-1">
                <MapValueInput
                  schema={valueSchema}
                  value={r.val}
                  ariaLabel={`Valeur de l'entrée ${i + 1}`}
                  onChange={(v) =>
                    commit(
                      rows.map((x) => (x.id === r.id ? { ...x, val: v } : x)),
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => commit(rows.filter((x) => x.id !== r.id))}
                aria-label={`Supprimer l'entrée ${i + 1}`}
                className="text-destructive hover:text-destructive mt-0.5 size-7"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={atMax}
          onClick={() =>
            commit([...rows, { id: nextId.current++, key: "", val: "" }])
          }
          className="border-dashed text-xs"
        >
          <Plus className="size-3" /> Ajouter une entrée
        </Button>
        {hasDuplicate && (
          <p className="text-destructive text-[11px]">
            Clés en double : seule la dernière valeur sera envoyée.
          </p>
        )}
        {atMax && (
          <p className="text-muted-foreground text-[11px]">
            Maximum {maxEntries} entrées.
          </p>
        )}
      </div>
    </Field>
  );
}

function MapValueInput({
  schema,
  value,
  onChange,
  ariaLabel,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  ariaLabel?: string;
}) {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "boolean") {
    return (
      <Checkbox
        checked={!!value}
        aria-label={ariaLabel}
        onCheckedChange={(c) => onChange(Boolean(c))}
      />
    );
  }
  if (type === "integer" || type === "number") {
    // Coerce to "" when the value isn't a finite number, so a blank/seeded
    // non-numeric value doesn't render as `0` or trigger React's NaN warning.
    const num = typeof value === "number" ? value : Number(value);
    return (
      <Input
        type="number"
        aria-label={ariaLabel}
        value={value === null || value === undefined || !Number.isFinite(num) ? "" : num}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(null);
          const n = type === "integer" ? parseInt(raw, 10) : parseFloat(raw);
          onChange(Number.isNaN(n) ? null : n);
        }}
      />
    );
  }
  return (
    <Input
      type={inputTypeForFormat(schema.format)}
      aria-label={ariaLabel}
      value={value === null || value === undefined ? "" : String(value)}
      maxLength={schema.maxLength}
      placeholder="valeur"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function OneOfField({
  variants,
  value,
  onChange,
  label,
  hint,
  required,
  discriminator,
}: {
  variants: JsonSchema[];
  value: unknown;
  onChange: (next: unknown) => void;
  label: string;
  hint?: string;
  required?: boolean;
  discriminator?: string;
}) {
  const tags = variants.map((v, i) => discriminatorLabel(v, discriminator, i));
  const currentIdx = useMemo(() => {
    if (!discriminator) return 0;
    const obj = value as Record<string, unknown> | null;
    const current = obj?.[discriminator];
    if (current === undefined) return 0;
    const idx = variants.findIndex((v) => {
      const disc = v.properties?.[discriminator];
      return disc?.const === current || disc?.enum?.includes(current as never);
    });
    return idx >= 0 ? idx : 0;
  }, [value, variants, discriminator]);

  const chosen = variants[currentIdx];
  return (
    <Field label={label} hint={hint} required={required}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChange(defaultFromSchema(variants[i]))}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                i === currentIdx
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-foreground hover:bg-accent",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <SchemaField schema={chosen} value={value} onChange={onChange} />
      </div>
    </Field>
  );
}

function discriminatorLabel(
  schema: JsonSchema,
  discriminator: string | undefined,
  fallbackIdx: number,
): string {
  if (discriminator) {
    const v = schema.properties?.[discriminator];
    if (v?.const !== undefined) return String(v.const);
    if (v?.enum?.length) return String(v.enum[0]);
  }
  return schema.title ?? `variante ${fallbackIdx + 1}`;
}

function inputTypeForFormat(format?: string): string {
  switch (format) {
    case "email":
      return "email";
    case "uri":
    case "url":
      return "url";
    case "date":
      return "date";
    case "date-time":
      return "datetime-local";
    case "password":
      return "password";
    default:
      return "text";
  }
}

function coerceString(raw: string, schema: JsonSchema): unknown {
  if (raw === "") return null;
  if (schema.enum?.includes(raw)) return raw;
  if (schema.type === "integer" || schema.type === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

// A "map" schema is an object whose shape is open (`additionalProperties` is a
// value schema) with no fixed `properties` — rendered as a key-value editor.
function isMapSchema(s: JsonSchema): boolean {
  const ap = s.additionalProperties;
  if (!ap || typeof ap !== "object") return false;
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const objectish = types.length === 0 || types.includes("object");
  const hasProps = !!s.properties && Object.keys(s.properties).length > 0;
  return objectish && !hasProps;
}

function mergeAllOf(schema: JsonSchema): JsonSchema {
  if (!schema.allOf?.length) return schema;
  const merged: JsonSchema = { ...schema };
  delete merged.allOf;
  for (const part of schema.allOf) {
    const m = mergeAllOf(part);
    if (m.properties) {
      merged.properties = { ...(merged.properties ?? {}), ...m.properties };
    }
    if (m.required) {
      merged.required = Array.from(
        new Set([...(merged.required ?? []), ...m.required]),
      );
    }
    if (m.type && !merged.type) merged.type = m.type;
    if (m.description && !merged.description) merged.description = m.description;
    if (m.title && !merged.title) merged.title = m.title;
  }
  return merged;
}

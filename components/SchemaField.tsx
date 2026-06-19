"use client";

import { useMemo } from "react";
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
import Field from "@/components/Field";
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
      {hint && (
        <p className="text-muted-foreground -mt-1 text-[11px]">{hint}</p>
      )}
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

import type { JsonSchema } from "@/lib/types";

// Flattens an `allOf` chain into a single schema: properties and `required` are
// merged across parts, while scalar fields (`type`/`description`/`title`) take
// the first value seen. Recursive so nested `allOf` parts merge too.
export function mergeAllOf(schema: JsonSchema): JsonSchema {
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

// A `oneOf`/`anyOf` branch that only means "may be null" — e.g. the second
// branch of `oneOf: [{type: string, format: date}, {type: "null"}]`. This is
// how the OpenAPI specs express nullability (the `type: [X, "null"]` shorthand
// is banned there because it breaks `oasdiff --flatten-allof`).
export function isNullBranch(schema: JsonSchema): boolean {
  return schema.type === "null";
}

// Drops pure-null branches from a `oneOf`/`anyOf` so a nullable field renders as
// itself instead of a `variante 1 / variante 2` switcher. When exactly one real
// branch remains, the union collapses into that branch (marked `nullable`),
// preserving the property-level description/example/title as fallbacks.
export function collapseNullableVariants(schema: JsonSchema): JsonSchema {
  const key = schema.oneOf ? "oneOf" : schema.anyOf ? "anyOf" : null;
  if (!key) return schema;
  const variants = schema[key] as JsonSchema[];
  const nonNull = variants.filter((v) => !isNullBranch(v));
  if (nonNull.length === variants.length) return schema; // no null branch

  if (nonNull.length === 0) {
    // Every branch was null — the field can only ever be null. Render it as a
    // plain `null` type (SchemaField shows nothing) instead of an empty union
    // that would fall through to a stray free-text input.
    const collapsed: JsonSchema = { ...schema, type: "null", nullable: true };
    delete collapsed.oneOf;
    delete collapsed.anyOf;
    delete collapsed.discriminator;
    return collapsed;
  }

  if (nonNull.length === 1) {
    // Recurse so a union nested inside the sole branch (or its own null branch)
    // collapses too, instead of being silently dropped by the deletes below.
    const only = collapseNullableVariants(mergeAllOf(nonNull[0]));
    const collapsed: JsonSchema = { ...schema, ...only };
    // Drop only the *wrapper's* union keys; when the surviving branch is itself
    // a union, `only` supplied it via the spread and we must keep it.
    if (!only.oneOf) delete collapsed.oneOf;
    if (!only.anyOf) delete collapsed.anyOf;
    if (!only.discriminator) delete collapsed.discriminator;
    // The nullable wrapper is where these specs put the field-level docs; the
    // branch is usually anonymous, so property-level values win.
    collapsed.description = schema.description ?? only.description;
    collapsed.example = schema.example ?? only.example;
    collapsed.title = schema.title ?? only.title;
    // An object branch declared only via `properties`/`allOf` can lack an
    // explicit type; without it SchemaField renders a bare text input.
    if (
      !collapsed.type &&
      collapsed.properties &&
      !collapsed.oneOf &&
      !collapsed.anyOf
    ) {
      collapsed.type = "object";
    }
    collapsed.nullable = true;
    return collapsed;
  }

  // Multiple real branches: keep the switcher, just without the null pill.
  return { ...schema, [key]: nonNull, nullable: true };
}

// Orders object entries so required fields render before optional ones, each
// group keeping its original (schema) order. Shared by the JSON body form
// (SchemaField's ObjectField) and the multipart body form so the two never
// drift. `entries` should already be filtered (e.g. readOnly removed).
export function partitionRequiredFirst(
  entries: [string, JsonSchema][],
  required: Set<string>,
): [string, JsonSchema][] {
  return [
    ...entries.filter(([name]) => required.has(name)),
    ...entries.filter(([name]) => !required.has(name)),
  ];
}

// Whether a JSON body schema gives the user anything to fill. An object whose
// every property is `readOnly` renders an empty fieldset — e.g. the
// French-residency upsert, whose sole field is a server-managed `const`
// discriminator — so callers can hide the body tab for it. Maps, unions,
// arrays and scalars always count as content.
export function bodyHasEditableFields(schema: JsonSchema | undefined): boolean {
  if (!schema) return false;
  const eff = collapseNullableVariants(mergeAllOf(schema));
  const isMap =
    !!eff.additionalProperties && typeof eff.additionalProperties === "object";
  const type = Array.isArray(eff.type) ? eff.type[0] : eff.type;
  if (!isMap && (type === "object" || eff.properties)) {
    return Object.values(eff.properties ?? {}).some((s) => !s.readOnly);
  }
  return true;
}

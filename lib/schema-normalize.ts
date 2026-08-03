import type { JsonSchema } from "@/lib/types";

// Flattens an `allOf` chain into a single schema. Recursive, so nested `allOf`
// parts flatten too.
//   • `properties` — merged; a LATER part refines an earlier one, which is the
//     `allOf: [$ref Base, {type: object, properties: {…}}]` extension idiom.
//   • `required`   — unioned: `allOf` means *every* branch must validate.
//   • numeric bounds — TIGHTENED, because `allOf` is an intersection: an upper
//     bound takes the smallest value seen, a lower bound the largest. This is
//     how a spec narrows a shared type (`allOf: [$ref FreeText, {maxLength:
//     20}]`); outer-wins there would advertise the base's looser limit and let
//     the user type a value the server rejects.
//   • `readOnly` — unioned: it marks a field as server-managed, so one branch
//     saying so is enough. (Not a validation keyword, hence not "tightened".)
//   • every other keyword (enum, const, format, example, default, pattern,
//     items, additionalProperties, …) is lifted verbatim, OUTER-WINS then
//     first-branch-wins. These specs annotate a `$ref` at the property level —
//         type: { description: …, allOf: [ {$ref: DocumentType} ], example: … }
//     — so the property's own description/example must beat the shared schema's;
//     same rule as `collapseNullableVariants` below and `deref`'s sibling
//     spread. Before this, only type/description/title were lifted, so an
//     `enum` behind an `allOf` never reached SchemaField and the field rendered
//     as free text. Two conflicting `enum`s would strictly intersect; no spec
//     pairs two enum branches, so first-wins is equivalent here and can't yield
//     an empty option list. Two `pattern`s cannot be intersected at all.
//   • `oneOf`/`anyOf`/`discriminator` are deliberately NOT lifted: SchemaField
//     tests them before the type switch, so lifting one into a schema that also
//     has `properties` would silently swap the object form for a branch picker.
//     No spec wraps a union in an `allOf`; revisit with a case to back it.

// Upper bounds intersect to the smallest value, lower bounds to the largest.
const UPPER_BOUNDS = [
  "maxLength",
  "maximum",
  "exclusiveMaximum",
  "maxItems",
  "maxProperties",
] as const;
const LOWER_BOUNDS = [
  "minLength",
  "minimum",
  "exclusiveMinimum",
  "minItems",
  "minProperties",
] as const;

export function mergeAllOf(schema: JsonSchema): JsonSchema {
  if (!schema.allOf?.length) return schema;
  let merged: JsonSchema = { ...schema };
  delete merged.allOf;
  for (const part of schema.allOf) {
    const {
      properties,
      required,
      allOf: _allOf,
      oneOf: _oneOf,
      anyOf: _anyOf,
      discriminator: _discriminator,
      ...rest
    } = mergeAllOf(part);
    // Spread order IS the precedence rule: everything `merged` already carries
    // (the outer schema, then earlier branches) shadows this branch. Key
    // presence, not truthiness — so an outer `minLength: 0` /
    // `additionalProperties: false` survives.
    const branch = rest;
    merged = { ...branch, ...merged };
    for (const k of UPPER_BOUNDS) {
      if (branch[k] !== undefined) {
        merged[k] =
          merged[k] === undefined ? branch[k] : Math.min(merged[k], branch[k]);
      }
    }
    for (const k of LOWER_BOUNDS) {
      if (branch[k] !== undefined) {
        merged[k] =
          merged[k] === undefined ? branch[k] : Math.max(merged[k], branch[k]);
      }
    }
    if (branch.readOnly) merged.readOnly = true;
    if (properties) {
      merged.properties = { ...(merged.properties ?? {}), ...properties };
    }
    if (required) {
      merged.required = Array.from(
        new Set([...(merged.required ?? []), ...required]),
      );
    }
  }
  return merged;
}

// Whether a property is server-managed. Reads through an `allOf` wrapper —
// `createdBy: {description: …, allOf: [{$ref: AuditField}]}` carries its
// `readOnly` on the branch, so a raw `sub.readOnly` test would miss it and the
// field would be rendered and seeded into a write body.
export function isReadOnly(schema: JsonSchema): boolean {
  return !!mergeAllOf(schema).readOnly;
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
  // Same "map" test as SchemaField's isMapSchema: declared `properties` win
  // over `additionalProperties`. Without the `properties` guard, a schema that
  // merely *inherits* `additionalProperties` from an allOf base would be read
  // as a free-form map and skip the readOnly check below.
  const hasProps = !!eff.properties && Object.keys(eff.properties).length > 0;
  const isMap =
    !hasProps &&
    !!eff.additionalProperties &&
    typeof eff.additionalProperties === "object";
  const type = Array.isArray(eff.type) ? eff.type[0] : eff.type;
  if (!isMap && (type === "object" || eff.properties)) {
    return Object.values(eff.properties ?? {}).some((s) => !isReadOnly(s));
  }
  return true;
}

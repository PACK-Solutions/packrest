import type { JsonSchema } from "@/lib/types";

// Semantic category of a descriptor, mapped to a pastel badge colour by the
// renderer (ConstraintBadges). Keeps the colour choice out of this pure module.
export type ConstraintTone = "type" | "format" | "constraint" | "pattern";

export interface ConstraintDescriptor {
  label: string;
  tone: ConstraintTone;
}

// Turns a JSON Schema into an ordered list of short, technical descriptors
// (OpenAPI keyword style) surfaced next to a field so the user knows the type
// and constraints to respect. Pure — no React — so both the body form
// (SchemaField) and the query/path params (ParamGroup) can reuse it.
//
// `enum` and `required` are intentionally omitted: the enum values are already
// materialised by the <Select>, and required is already shown by the label's
// asterisk.
export function describeConstraints(
  schema: JsonSchema | undefined,
): ConstraintDescriptor[] {
  if (!schema) return [];
  const parts: ConstraintDescriptor[] = [];
  const push = (label: string, tone: ConstraintTone) => parts.push({ label, tone });

  const type = normalizeType(schema.type);
  if (type) push(type, "type");
  if (schema.format) push(`format: ${schema.format}`, "format");

  // string
  if (schema.minLength != null) push(`minLength ${schema.minLength}`, "constraint");
  if (schema.maxLength != null) push(`maxLength ${schema.maxLength}`, "constraint");
  if (schema.pattern) push(`pattern: ${schema.pattern}`, "pattern");

  // number / integer
  if (schema.exclusiveMinimum != null) push(`> ${schema.exclusiveMinimum}`, "constraint");
  else if (schema.minimum != null) push(`min ${schema.minimum}`, "constraint");
  if (schema.exclusiveMaximum != null) push(`< ${schema.exclusiveMaximum}`, "constraint");
  else if (schema.maximum != null) push(`max ${schema.maximum}`, "constraint");
  if (schema.multipleOf != null) push(`multipleOf ${schema.multipleOf}`, "constraint");

  // array
  if (schema.minItems != null) push(`minItems ${schema.minItems}`, "constraint");
  if (schema.maxItems != null) push(`maxItems ${schema.maxItems}`, "constraint");

  return parts;
}

// Pick the first non-null type when `type` is an array (e.g. ["string","null"]).
function normalizeType(type: JsonSchema["type"]): string | undefined {
  if (Array.isArray(type)) return type.find((t) => t !== "null");
  return type || undefined;
}

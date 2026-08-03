import type {
  JsonSchema,
  OpenApiOperation,
  OpenApiParameter,
} from "./types";
import { isReadOnly, mergeAllOf } from "./schema-normalize";

export interface BodyExample {
  id: string;
  summary?: string;
  description?: string;
  value: unknown;
}

// Returns the list of body examples declared on the JSON content type, in
// preference order: explicit `examples` map (one tab per key), then a
// single `example`, then the schema-level example as a last resort.
export function extractBodyExamples(
  operation: OpenApiOperation,
): BodyExample[] {
  const media = operation.requestBody?.content?.["application/json"];
  if (!media) return [];
  if (media.examples) {
    return Object.entries(media.examples).map(([id, ex]) => ({
      id,
      summary: ex.summary,
      description: ex.description,
      value: ex.value,
    }));
  }
  if (media.example !== undefined) {
    return [{ id: "default", value: media.example }];
  }
  if (media.schema?.example !== undefined) {
    return [{ id: "default", value: media.schema.example }];
  }
  return [];
}

// Best-effort scalar example for path/query/header parameters. Lints
// usually keep these singular.
export function extractParameterExample(parameter: OpenApiParameter): unknown {
  if (parameter.example !== undefined) return parameter.example;
  if (parameter.examples) {
    const first = Object.values(parameter.examples)[0];
    if (first?.value !== undefined) return first.value;
  }
  if (parameter.schema?.example !== undefined) return parameter.schema.example;
  if (parameter.schema?.default !== undefined) return parameter.schema.default;
  if (parameter.schema?.enum?.length) return parameter.schema.enum[0];
  return "";
}

// Builds a default value tree from a JSON Schema. Used as a fallback when
// no examples are provided so the form starts populated rather than blank.
export function defaultFromSchema(schema: JsonSchema | undefined): unknown {
  if (!schema) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  // oneOf/anyOf: take the first real (non-null) branch
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants?.length) {
    const pick = variants.find((v) => v.type !== "null") ?? variants[0];
    return defaultFromSchema(pick);
  }
  // Flatten first, exactly like emptyValueFromSchema: the old per-branch reduce
  // dropped a scalar branch's value and returned `{}`, so an `allOf`-wrapped
  // enum was exported to Bruno as `"type": {}`.
  if (schema.allOf?.length) return defaultFromSchema(mergeAllOf(schema));
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  // An object composed only via `properties` can lack an explicit `type` —
  // the same inference collapseNullableVariants makes.
  if (type === "object" || (!type && schema.properties)) {
    const obj: Record<string, unknown> = {};
    const props = schema.properties ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (isReadOnly(sub)) continue;
      obj[key] = defaultFromSchema(sub);
    }
    return obj;
  }
  switch (type) {
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "null":
      return null;
    default:
      return null;
  }
}

// Builds an EMPTY value tree for a JSON Schema: the structural skeleton (nested
// objects/arrays) with every scalar leaf left blank. Unlike defaultFromSchema
// it deliberately ignores the schema's `example` / `default` / `enum` values —
// the app's forms start empty by design so the user always types (or picks) the
// exact values they send. Only `const` is kept: it's a fixed, read-only value
// (and drives oneOf discriminators), not a suggested example.
export function emptyValueFromSchema(schema: JsonSchema | undefined): unknown {
  if (!schema) return undefined;
  if (schema.const !== undefined) return schema.const;
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants?.length) {
    // A nullable union (has a null branch) stays blank so the key is omitted
    // from the payload until the user fills it — matches the "start empty"
    // contract and avoids seeding an empty {}/[] the backend may reject.
    if (variants.some((v) => v.type === "null")) return undefined;
    const pick = variants.find((v) => v.type !== "null") ?? variants[0];
    return emptyValueFromSchema(pick);
  }
  // Flatten first: an `allOf`-wrapped *scalar* (the `{description, allOf:
  // [$ref SomeEnum]}` idiom) must stay blank, not become a stray `{}` in the
  // seeded body. Objects are unaffected — the merged `properties` rebuild the
  // same keys.
  if (schema.allOf?.length) return emptyValueFromSchema(mergeAllOf(schema));
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  // An object composed only via `properties`/`allOf` can lack an explicit
  // `type` — the same inference collapseNullableVariants makes. Without it a
  // merged `allOf: [$ref Party, $ref ContactInfo]` would seed nothing at all.
  if (type === "object" || (!type && schema.properties)) {
    const obj: Record<string, unknown> = {};
    const props = schema.properties ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (isReadOnly(sub)) continue;
      obj[key] = emptyValueFromSchema(sub);
    }
    return obj;
  }
  if (type === "array") return [];
  // string / number / integer / boolean / null → leave blank (undefined),
  // so JSON.stringify omits the key until the user fills it.
  return undefined;
}

// Value for a freshly-added array element. A scalar item gets a *typed* empty
// ("" for string, 0 for number/integer, false for boolean) rather than the
// `undefined` emptyValueFromSchema returns for scalars — an untouched array item
// left `undefined` serialises as `null` (`[null]`), which a typed-array backend
// rejects, whereas `[""]`/`[0]`/`[false]` stay type-correct. Objects/arrays and
// composite (oneOf/anyOf/allOf) items defer to emptyValueFromSchema so their
// leaves still start blank/omitted.
export function blankArrayItem(schema: JsonSchema | undefined): unknown {
  if (!schema) return "";
  // Flatten `allOf` first so a *wrapped* scalar (`items: {description: …,
  // allOf: [$ref DocumentType]}`) still gets its typed empty. Deferring the
  // whole wrapper to emptyValueFromSchema would hand back `undefined` → `null`.
  const eff = schema.allOf?.length ? mergeAllOf(schema) : schema;
  if (eff.const !== undefined) return eff.const;
  if (eff.oneOf || eff.anyOf) return emptyValueFromSchema(eff);
  const type = Array.isArray(eff.type) ? eff.type[0] : eff.type;
  if (type === "object" || type === "array" || (!type && eff.properties)) {
    return emptyValueFromSchema(eff);
  }
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  return ""; // string / untyped
}

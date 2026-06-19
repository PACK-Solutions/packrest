import type {
  JsonSchema,
  OpenApiOperation,
  OpenApiParameter,
} from "./types";

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
  // oneOf/anyOf: take the first branch
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants?.length) return defaultFromSchema(variants[0]);
  if (schema.allOf?.length) {
    return schema.allOf.reduce<Record<string, unknown>>(
      (acc, part) => {
        const v = defaultFromSchema(part);
        return v && typeof v === "object" && !Array.isArray(v)
          ? { ...acc, ...(v as Record<string, unknown>) }
          : acc;
      },
      {},
    );
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
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
    case "object": {
      const obj: Record<string, unknown> = {};
      const props = schema.properties ?? {};
      for (const [key, sub] of Object.entries(props)) {
        if (sub.readOnly) continue;
        obj[key] = defaultFromSchema(sub);
      }
      return obj;
    }
    case "null":
      return null;
    default:
      return null;
  }
}

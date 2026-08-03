import { describe, expect, it } from "vitest";
import {
  bodyHasEditableFields,
  collapseNullableVariants,
  isReadOnly,
  mergeAllOf,
} from "@/lib/schema-normalize";
import {
  blankArrayItem,
  defaultFromSchema,
  emptyValueFromSchema,
} from "@/lib/example-extractor";
import type { JsonSchema } from "@/lib/types";

// The catalog enum the specs `$ref` from a property-level wrapper (trimmed).
const documentType: JsonSchema = {
  type: "string",
  title: "DocumentType",
  enum: ["PROOF_OF_ADDRESS", "PROOF_OF_IDENTITY"],
};

describe("mergeAllOf", () => {
  it("returns the same object when there is no allOf", () => {
    const schema: JsonSchema = { type: "string", enum: ["A"] };
    // Same reference: SchemaField's useMemo and the null-collapse tests rely
    // on identity here.
    expect(mergeAllOf(schema)).toBe(schema);
  });

  it("lifts an enum out of an allOf branch (DocumentReference.type)", () => {
    // The idiom that broke the form: a $ref'd enum annotated at the property
    // level. Before the fix only type/description/title were lifted, so the
    // field fell through to a free-text input.
    const schema: JsonSchema = {
      description: "Type of the referenced document, from the shared catalog.",
      allOf: [documentType],
      example: "PROOF_OF_ADDRESS",
    };
    const out = mergeAllOf(schema);
    expect(out.enum).toEqual(["PROOF_OF_ADDRESS", "PROOF_OF_IDENTITY"]);
    expect(out.type).toBe("string");
    expect(out.allOf).toBeUndefined();
  });

  it("lets the outer schema win over a branch", () => {
    const out = mergeAllOf({
      description: "outer desc",
      title: "outer title",
      example: "outer example",
      default: "outer default",
      allOf: [
        {
          type: "string",
          description: "branch desc",
          title: "branch title",
          example: "branch example",
          default: "branch default",
        },
      ],
    });
    expect(out.description).toBe("outer desc");
    expect(out.title).toBe("outer title");
    expect(out.example).toBe("outer example");
    expect(out.default).toBe("outer default");
    expect(out.type).toBe("string"); // only declared by the branch
  });

  it("lets the first branch win over later ones", () => {
    const out = mergeAllOf({
      allOf: [{ format: "uuid" }, { format: "date" }],
    });
    expect(out.format).toBe("uuid");
  });

  it("lifts validation keywords so ConstraintBadges can render them", () => {
    const out = mergeAllOf({
      description: "outer",
      allOf: [
        {
          type: "string",
          format: "uuid",
          pattern: "^[A-Z]+$",
          minLength: 3,
          maxLength: 36,
          minimum: 1,
          maximum: 10,
          multipleOf: 2,
          minItems: 1,
          maxItems: 5,
          const: "X",
          readOnly: true,
          nullable: true,
        },
      ],
    });
    expect(out).toMatchObject({
      format: "uuid",
      pattern: "^[A-Z]+$",
      minLength: 3,
      maxLength: 36,
      minimum: 1,
      maximum: 10,
      multipleOf: 2,
      minItems: 1,
      maxItems: 5,
      const: "X",
      readOnly: true,
      nullable: true,
    });
  });

  it("tightens bounds instead of letting the looser base win", () => {
    // `allOf: [$ref FreeText, {maxLength: 20}]` is how a spec narrows a shared
    // type. First-branch-wins would advertise the base's 255 and let the user
    // type a value the server rejects.
    const out = mergeAllOf({
      allOf: [
        { type: "string", maxLength: 255, minLength: 1 },
        { maxLength: 20, minLength: 5 },
      ],
    });
    expect(out.maxLength).toBe(20);
    expect(out.minLength).toBe(5);
  });

  it("tightens bounds declared on the outer schema too", () => {
    const out = mergeAllOf({
      maximum: 100,
      minItems: 1,
      allOf: [{ maximum: 10, minItems: 3 }],
    });
    expect(out.maximum).toBe(10);
    expect(out.minItems).toBe(3);
  });

  it("unions readOnly — one branch marking the field is enough", () => {
    const out = mergeAllOf({
      description: "outer",
      allOf: [{ type: "string", readOnly: true }],
    });
    expect(out.readOnly).toBe(true);
  });

  it("does not clobber falsy outer values (presence, not truthiness)", () => {
    const out = mergeAllOf({
      minLength: 0,
      additionalProperties: false,
      allOf: [{ format: "uuid", additionalProperties: { type: "string" } }],
    });
    // minLength is a lower bound: the branch declares none, so 0 stands.
    expect(out.minLength).toBe(0);
    expect(out.additionalProperties).toBe(false);
  });

  it("lifts items and array constraints", () => {
    const out = mergeAllOf({
      description: "outer",
      allOf: [{ type: "array", items: { type: "string" }, maxItems: 3 }],
    });
    expect(out.type).toBe("array");
    expect(out.items?.type).toBe("string");
    expect(out.maxItems).toBe(3);
  });

  it("merges properties with a later branch refining an earlier one", () => {
    // Deliberate asymmetry vs. scalars: `allOf: [$ref Base, {properties: …}]`
    // is the extension idiom, so the extension wins.
    const out = mergeAllOf({
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { a: { type: "integer" }, b: {} } },
      ],
    });
    expect(out.properties?.a.type).toBe("integer");
    expect(out.properties?.b).toBeDefined();
  });

  it("unions and dedupes required across the outer schema and branches", () => {
    const out = mergeAllOf({
      required: ["id"],
      allOf: [{ required: ["id", "type"] }, { required: ["status"] }],
    });
    expect(out.required?.slice().sort()).toEqual(["id", "status", "type"]);
  });

  it("flattens nested allOf", () => {
    const out = mergeAllOf({ allOf: [{ allOf: [documentType] }] });
    expect(out.enum).toEqual(["PROOF_OF_ADDRESS", "PROOF_OF_IDENTITY"]);
    expect(out.allOf).toBeUndefined();
  });

  it("does not lift oneOf/anyOf/discriminator out of a branch", () => {
    // Lifting one would swap SchemaField's object form for a branch picker,
    // since it tests unions before the type switch.
    const out = mergeAllOf({
      type: "object",
      properties: { k: { type: "string" } },
      allOf: [
        {
          oneOf: [{ type: "string" }, { type: "integer" }],
          discriminator: { propertyName: "k" },
        },
        { anyOf: [{ required: ["k"] }] },
      ],
    });
    expect(out.oneOf).toBeUndefined();
    expect(out.anyOf).toBeUndefined();
    expect(out.discriminator).toBeUndefined();
    expect(out.properties?.k).toBeDefined();
  });

  it("does not mutate its input", () => {
    const schema: JsonSchema = {
      description: "outer",
      allOf: [documentType, { type: "object", properties: { a: {} } }],
    };
    const clone = structuredClone(schema);
    mergeAllOf(schema);
    expect(schema).toEqual(clone);
  });
});

describe("collapseNullableVariants with an allOf branch", () => {
  it("keeps the enum of a nullable allOf-wrapped enum", () => {
    const out = collapseNullableVariants({
      description: "outer desc",
      oneOf: [{ allOf: [documentType] }, { type: "null" }],
    });
    expect(out.enum).toEqual(["PROOF_OF_ADDRESS", "PROOF_OF_IDENTITY"]);
    expect(out.nullable).toBe(true);
    expect(out.oneOf).toBeUndefined();
    expect(out.description).toBe("outer desc");
  });

  it("works with the null branch first", () => {
    const out = collapseNullableVariants({
      anyOf: [{ type: "null" }, { allOf: [documentType] }],
    });
    expect(out.enum).toEqual(["PROOF_OF_ADDRESS", "PROOF_OF_IDENTITY"]);
    expect(out.nullable).toBe(true);
    expect(out.anyOf).toBeUndefined();
  });
});

describe("bodyHasEditableFields with the richer merge", () => {
  it("stays false when every merged property is readOnly", () => {
    expect(
      bodyHasEditableFields({
        allOf: [
          {
            type: "object",
            properties: {
              fiscal_type: {
                type: "string",
                readOnly: true,
                const: "FRENCH_RESIDENCY",
              },
            },
            required: ["fiscal_type"],
          },
        ],
      }),
    ).toBe(false);
  });

  it("is true when a later branch adds an editable property", () => {
    expect(
      bodyHasEditableFields({
        allOf: [
          { type: "object", properties: { a: { readOnly: true } } },
          { type: "object", properties: { b: { type: "string" } } },
        ],
      }),
    ).toBe(true);
  });

  it("is true for a branch declaring a free-form map", () => {
    expect(
      bodyHasEditableFields({
        allOf: [{ type: "object", additionalProperties: { type: "string" } }],
      }),
    ).toBe(true);
  });

  it("declared properties beat an inherited additionalProperties", () => {
    // A schema extending an open base is NOT a map — the readOnly check must
    // still run, exactly as SchemaField's isMapSchema decides.
    expect(
      bodyHasEditableFields({
        allOf: [
          { type: "object", additionalProperties: { type: "string" } },
          { type: "object", properties: { a: { readOnly: true } } },
        ],
      }),
    ).toBe(false);
  });

  it("sees readOnly through an allOf wrapper on a property", () => {
    expect(
      bodyHasEditableFields({
        type: "object",
        properties: {
          createdBy: { description: "…", allOf: [{ readOnly: true }] },
        },
      }),
    ).toBe(false);
  });
});

describe("isReadOnly", () => {
  it("reads through an allOf wrapper", () => {
    expect(isReadOnly({ description: "…", allOf: [{ readOnly: true }] })).toBe(
      true,
    );
    expect(isReadOnly({ type: "string" })).toBe(false);
  });
});

describe("emptyValueFromSchema with an allOf branch", () => {
  it("leaves an allOf-wrapped scalar blank instead of seeding {}", () => {
    expect(
      emptyValueFromSchema({
        description: "Type of the referenced document.",
        allOf: [documentType],
        example: "PROOF_OF_ADDRESS",
      }),
    ).toBeUndefined();
  });

  it("still rebuilds object keys through the merge", () => {
    // DocumentReference-shaped: the wrapped scalar must not become {}.
    expect(
      blankArrayItem({
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          type: { description: "…", allOf: [documentType] },
        },
      }),
    ).toEqual({ id: undefined, type: undefined });
  });

  it("seeds a merged object that declares no explicit type", () => {
    // `holder: {allOf: [$ref Party, $ref ContactInfo]}` where neither component
    // carries `type: object` — the skeleton must still be built.
    expect(
      emptyValueFromSchema({
        allOf: [
          { properties: { a: { type: "string" } } },
          { properties: { b: { type: "string" } } },
        ],
      }),
    ).toEqual({ a: undefined, b: undefined });
  });

  it("skips a property whose readOnly hides behind an allOf", () => {
    expect(
      emptyValueFromSchema({
        type: "object",
        properties: {
          id: { type: "string" },
          createdBy: { description: "…", allOf: [{ readOnly: true }] },
        },
      }),
    ).toEqual({ id: undefined });
  });
});

describe("blankArrayItem with an allOf-wrapped item", () => {
  it("gives a wrapped string enum a typed empty, not undefined", () => {
    // `undefined` in an array serialises as `[null]`, which a typed-array
    // backend rejects — the exact case this helper exists to prevent.
    expect(
      blankArrayItem({ description: "…", allOf: [documentType] }),
    ).toBe("");
  });

  it("gives a wrapped numeric item 0", () => {
    expect(blankArrayItem({ allOf: [{ type: "integer" }] })).toBe(0);
  });

  it("still builds a skeleton for a wrapped object", () => {
    expect(
      blankArrayItem({
        allOf: [{ type: "object", properties: { a: { type: "string" } } }],
      }),
    ).toEqual({ a: undefined });
  });
});

describe("defaultFromSchema with an allOf branch", () => {
  it("keeps a wrapped scalar's value instead of returning {}", () => {
    // Bruno export path: the old per-branch reduce emitted `"type": {}`.
    expect(defaultFromSchema({ allOf: [documentType] })).toBe(
      "PROOF_OF_ADDRESS",
    );
  });

  it("still merges object branches", () => {
    expect(
      defaultFromSchema({
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "integer" } } },
        ],
      }),
    ).toEqual({ a: "", b: 0 });
  });
});

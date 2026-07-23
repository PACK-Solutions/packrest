import { describe, expect, it } from "vitest";
import {
  bodyHasEditableFields,
  collapseNullableVariants,
  isNullBranch,
} from "@/lib/schema-normalize";
import {
  defaultFromSchema,
  emptyValueFromSchema,
} from "@/lib/example-extractor";
import type { JsonSchema } from "@/lib/types";

const dateBranch: JsonSchema = {
  type: "string",
  format: "date",
  minLength: 10,
  maxLength: 10,
};

describe("isNullBranch", () => {
  it("detects a pure null branch", () => {
    expect(isNullBranch({ type: "null" })).toBe(true);
    expect(isNullBranch(dateBranch)).toBe(false);
  });
});

describe("collapseNullableVariants", () => {
  it("collapses [value, null] into the single real branch, marked nullable", () => {
    const schema: JsonSchema = {
      oneOf: [dateBranch, { type: "null" }],
      description: "Date until which the account is valid.",
      example: "2026-12-31",
    };
    const out = collapseNullableVariants(schema);
    expect(out.oneOf).toBeUndefined();
    expect(out.anyOf).toBeUndefined();
    expect(out.type).toBe("string");
    expect(out.format).toBe("date");
    expect(out.nullable).toBe(true);
    // property-level description/example survive the collapse
    expect(out.description).toBe("Date until which the account is valid.");
    expect(out.example).toBe("2026-12-31");
  });

  it("collapses when the null branch is ordered first", () => {
    const out = collapseNullableVariants({
      oneOf: [{ type: "null" }, dateBranch],
    });
    expect(out.oneOf).toBeUndefined();
    expect(out.type).toBe("string");
    expect(out.nullable).toBe(true);
  });

  it("handles anyOf the same way", () => {
    const out = collapseNullableVariants({
      anyOf: [{ type: "string", maxLength: 50 }, { type: "null" }],
    });
    expect(out.anyOf).toBeUndefined();
    expect(out.type).toBe("string");
    expect(out.maxLength).toBe(50);
    expect(out.nullable).toBe(true);
  });

  it("keeps a genuine multi-branch union but drops the null pill", () => {
    const out = collapseNullableVariants({
      oneOf: [{ type: "string" }, { type: "integer" }, { type: "null" }],
    });
    expect(out.oneOf).toHaveLength(2);
    expect(out.oneOf?.some(isNullBranch)).toBe(false);
    expect(out.nullable).toBe(true);
  });

  it("leaves a null-free union untouched", () => {
    const schema: JsonSchema = {
      oneOf: [{ type: "string" }, { type: "integer" }],
    };
    expect(collapseNullableVariants(schema)).toBe(schema);
  });

  it("passes through a plain scalar schema", () => {
    expect(collapseNullableVariants(dateBranch)).toBe(dateBranch);
  });
});

describe("value extractors skip the null branch", () => {
  const nullFirst: JsonSchema = {
    oneOf: [{ type: "null" }, { type: "string", example: "hello" }],
  };

  it("defaultFromSchema seeds the real branch, not null", () => {
    expect(defaultFromSchema(nullFirst)).toBe("hello");
  });

  it("emptyValueFromSchema uses the real branch (blank string, not null)", () => {
    // string branch → emptyValueFromSchema returns undefined (blank), never null
    expect(emptyValueFromSchema(nullFirst)).toBeUndefined();
  });
});

describe("bodyHasEditableFields", () => {
  it("is false when every property is readOnly (French-residency upsert)", () => {
    const frenchResidencyCreate: JsonSchema = {
      allOf: [
        {
          type: "object",
          properties: {
            fiscal_type: { type: "string", readOnly: true, const: "FRENCH_RESIDENCY" },
          },
          required: ["fiscal_type"],
        },
      ],
    };
    expect(bodyHasEditableFields(frenchResidencyCreate)).toBe(false);
  });

  it("is true when at least one property is editable", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        fiscal_type: { type: "string", readOnly: true },
        tax_identification_number: { type: "string" },
      },
    };
    expect(bodyHasEditableFields(schema)).toBe(true);
  });

  it("treats a free-form map body as content", () => {
    expect(
      bodyHasEditableFields({ type: "object", additionalProperties: { type: "string" } }),
    ).toBe(true);
  });

  it("is false for undefined (no body)", () => {
    expect(bodyHasEditableFields(undefined)).toBe(false);
  });
});

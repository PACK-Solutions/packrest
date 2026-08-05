import { describe, expect, it } from "vitest";
import {
  coerceToSchema,
  SAMPLE_SKIP,
  sampleFromSchema,
  schemaAtPath,
  validateAgainstSchema,
  type SampleHint,
} from "@/lib/schema-sample";
import type { JsonSchema } from "@/lib/types";

// Fixed so date leaves are assertable.
const NOW = new Date("2026-08-05T10:30:00Z");
const TODAY = "2026-08-05";

const sample = (schema: JsonSchema, hints?: SampleHint[], extra = {}) =>
  sampleFromSchema(schema, { now: NOW, ...(hints ? { hints } : {}), ...extra });

// The contract change this whole module exists for.
const BENEFICIARY_CLAUSE: JsonSchema = {
  type: "object",
  required: ["content", "date_of_effect"],
  properties: {
    content: { type: "string", minLength: 1, maxLength: 2000 },
    date_of_effect: { type: "string", format: "date" },
    date_of_end: { type: "string", format: "date", readOnly: true },
  },
};

describe("sampleFromSchema — structure", () => {
  it("fills required properties only, by default", () => {
    expect(
      sample({
        type: "object",
        required: ["a"],
        properties: { a: { type: "string" }, b: { type: "string" } },
      }),
    ).toEqual({ a: "a" });
  });

  it("fills optional properties too under include: \"all\"", () => {
    expect(
      sample(
        {
          type: "object",
          required: ["a"],
          properties: { a: { type: "string" }, b: { type: "string" } },
        },
        undefined,
        { include: "all" },
      ),
    ).toEqual({ a: "a", b: "b" });
  });

  it("never sends a readOnly property — it is server-managed", () => {
    expect(sample(BENEFICIARY_CLAUSE)).toEqual({
      content: "content",
      date_of_effect: TODAY,
    });
    // Including through an allOf wrapper, where `readOnly` sits on the branch.
    expect(
      sample({
        type: "object",
        required: ["x", "y"],
        properties: {
          x: { type: "string" },
          y: { allOf: [{ type: "string", readOnly: true }] },
        },
      }),
    ).toEqual({ x: "x" });
  });

  it("recurses into nested required objects", () => {
    expect(
      sample({
        type: "object",
        required: ["birth"],
        properties: {
          birth: {
            type: "object",
            required: ["date_of_birth"],
            properties: { date_of_birth: { type: "string", format: "date" } },
          },
        },
      }),
    ).toEqual({ birth: { date_of_birth: TODAY } });
  });

  it("drops an optional object that would collapse to {}", () => {
    expect(
      sample(
        {
          type: "object",
          required: ["a"],
          properties: {
            a: { type: "string" },
            meta: { type: "object", properties: { x: { type: "string" } } },
          },
        },
        undefined,
        { include: "all" },
      ),
    ).toEqual({ a: "a", meta: { x: "x" } });
    // …but an object with no fillable property at all contributes nothing.
    expect(
      sample(
        {
          type: "object",
          required: ["a"],
          properties: {
            a: { type: "string" },
            meta: { type: "object", properties: {} },
          },
        },
        undefined,
        { include: "all" },
      ),
    ).toEqual({ a: "a" });
  });

  it("merges an allOf chain before reading it (the extension idiom)", () => {
    expect(
      sample({
        allOf: [
          { type: "object", required: ["a"], properties: { a: { type: "string" } } },
          { type: "object", required: ["b"], properties: { b: { type: "integer" } } },
        ],
      }),
    ).toEqual({ a: "a", b: 0 });
  });
});

describe("sampleFromSchema — arrays", () => {
  const items: JsonSchema = {
    type: "object",
    required: ["fund_id"],
    properties: { fund_id: { type: "string" } },
  };

  it("emits minItems rows, and one row for a required array with no minItems", () => {
    expect(sample({ type: "array", minItems: 2, items })).toEqual([
      { fund_id: "fund_id" },
      { fund_id: "fund_id" },
    ]);
    // An empty list carries no data — a required array is useless without a row.
    expect(sample({ type: "array", items })).toEqual([{ fund_id: "fund_id" }]);
  });

  it("never exceeds maxItems", () => {
    expect(
      sample({ type: "array", minItems: 5, maxItems: 2, items: { type: "string" } }),
    ).toHaveLength(2);
  });

  it("gives an optional array a row under include: \"all\", nothing by default", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["a"],
      properties: { a: { type: "string" }, tags: { type: "array", items } },
    };
    // Required-only: an optional list is left out entirely rather than sent empty.
    expect(sample(schema)).toEqual({ a: "a" });
    expect(sample(schema, undefined, { include: "all" })).toEqual({
      a: "a",
      tags: [{ fund_id: "fund_id" }],
    });
  });

  it("still omits an optional array whose items yield nothing", () => {
    expect(
      sample(
        {
          type: "object",
          required: ["a"],
          // `{}` is what deref leaves behind for a recursive re-entry.
          properties: { a: { type: "string" }, tags: { type: "array", items: {} } },
        },
        undefined,
        { include: "all" },
      ),
    ).toEqual({ a: "a" });
  });
});

describe("sampleFromSchema — leaves", () => {
  it("computes date and date-time rather than reusing a spec example", () => {
    // `example: 2026-09-01` on a must-be-future date goes stale as the release
    // ages, and a stale clause date is a 422 — so computed values win.
    expect(sample({ type: "string", format: "date", example: "2020-01-01" })).toBe(
      TODAY,
    );
    expect(sample({ type: "string", format: "date-time" })).toBe(
      NOW.toISOString(),
    );
  });

  it("uses default then example for everything else", () => {
    expect(sample({ type: "string", default: "D", example: "E" })).toBe("D");
    expect(sample({ type: "string", example: "E" })).toBe("E");
    expect(sample({ type: "integer", example: 42 })).toBe(42);
    expect(sample({ type: "boolean", default: true })).toBe(true);
  });

  it("emits a const verbatim and the first enum member", () => {
    expect(sample({ type: "string", const: "SEPA_DEBIT" })).toBe("SEPA_DEBIT");
    expect(sample({ type: "string", enum: ["MONTHLY", "QUARTERLY"] })).toBe(
      "MONTHLY",
    );
    // A default/example inside the enum wins over "first".
    expect(
      sample({ type: "string", enum: ["A", "B"], default: "B" }),
    ).toBe("B");
    // A null-only member never leaks out as the chosen value.
    expect(sample({ type: "string", enum: [null, "A"] })).toBe("A");
  });

  it("respects string length bounds", () => {
    expect(sample({ type: "string", minLength: 10 })).toHaveLength(10);
    expect(sample({ type: "string", maxLength: 2 })).toHaveLength(2);
  });

  it("satisfies a digit-only pattern instead of emitting the property name", () => {
    // The regression: a required `postal_code` with `^\d{5}$` came out as "posta"
    // — invalid, and the validator said nothing about it.
    const postal: JsonSchema = {
      type: "string",
      pattern: "^\\d{5}$",
      minLength: 5,
      maxLength: 5,
    };
    const v = sample(postal);
    expect(v).toMatch(/^\d{5}$/);
    expect(validateAgainstSchema(v, postal)).toEqual([]);
    expect(sample({ type: "string", pattern: "^\\d+$", minLength: 3 })).toMatch(
      /^\d{3,}$/,
    );
    expect(sample({ type: "string", pattern: "^\\d{9,12}$" })).toMatch(/^\d{9}$/);
  });

  it("reports a pattern it cannot satisfy rather than sending it silently", () => {
    // Not every pattern is generically satisfiable; the point is that the
    // guardrail now SEES the generator's own invalid output.
    const ref: JsonSchema = { type: "string", pattern: "^[A-Z]{2}-\\d{4}$" };
    const v = sample(ref);
    expect(validateAgainstSchema(v, ref).map((i) => i.kind)).toEqual([
      "constraint-violation",
    ]);
  });

  it("stays inside numeric bounds, honouring exclusivity and multipleOf", () => {
    expect(sample({ type: "integer", minimum: 5 })).toBe(5);
    expect(sample({ type: "integer", exclusiveMinimum: 5 })).toBe(6);
    expect(sample({ type: "integer", maximum: -3 })).toBe(-3);
    expect(sample({ type: "number", minimum: 10, multipleOf: 4 })).toBe(12);
    expect(sample({ type: "integer" })).toBe(0);
  });

  it("emits a uuid for format: uuid", () => {
    expect(sample({ type: "string", format: "uuid" })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("contributes nothing for an empty schema (deref's recursion placeholder)", () => {
    expect(sample({})).toBeUndefined();
    expect(sampleFromSchema(undefined)).toBeUndefined();
  });

  it("infers object/array from properties/items when `type` is absent", () => {
    expect(sample({ required: ["a"], properties: { a: { type: "string" } } })).toEqual({
      a: "a",
    });
  });
});

describe("sampleFromSchema — unions", () => {
  it("collapses a nullable union into its single real branch", () => {
    expect(
      sample({ oneOf: [{ type: "string", format: "date" }, { type: "null" }] }),
    ).toBe(TODAY);
  });

  it("takes the first branch that yields something", () => {
    expect(
      sample({
        anyOf: [
          {}, // yields nothing (deref's placeholder for a recursive re-entry)
          { type: "string", const: "NUMBER" },
        ],
      }),
    ).toBe("NUMBER");
  });
});

describe("sampleFromSchema — hints", () => {
  const clauseBody: JsonSchema = {
    type: "object",
    required: ["date_of_effect", "beneficiary_clause"],
    properties: {
      date_of_effect: { type: "string", format: "date" },
      beneficiary_clause: BENEFICIARY_CLAUSE,
    },
  };

  it("prefers path over name over format", () => {
    const hints: SampleHint[] = [
      { path: "beneficiary_clause.date_of_effect", value: () => "2026-12-01" },
      { name: "date_of_effect", value: () => "2026-08-05" },
      { format: "date", value: () => "1999-01-01" },
    ];
    expect(sample(clauseBody, hints)).toEqual({
      date_of_effect: "2026-08-05",
      beneficiary_clause: { content: "content", date_of_effect: "2026-12-01" },
    });
  });

  it("distinguishes the two date_of_effect leaves — the whole point of path hints", () => {
    // Both are {type: string, format: date}, but the clause's must be strictly
    // later than the request date while the contract's is today.
    const out = sample(clauseBody, [
      { path: "beneficiary_clause.date_of_effect", value: () => "2026-08-06" },
    ]) as { date_of_effect: string; beneficiary_clause: { date_of_effect: string } };
    expect(out.date_of_effect).toBe(TODAY);
    expect(out.beneficiary_clause.date_of_effect).toBe("2026-08-06");
  });

  it("matches an array leaf at any index with []", () => {
    expect(
      sample(
        {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            required: ["fund_id"],
            properties: { fund_id: { type: "string" } },
          },
        },
        [{ path: "[].fund_id", value: () => "f-1" }],
      ),
    ).toEqual([{ fund_id: "f-1" }, { fund_id: "f-1" }]);
  });

  it("ignores a hint the contract can no longer hold", () => {
    // A hint that has fallen behind must degrade to the schema value, not
    // produce an invalid body.
    expect(sample({ type: "integer" }, [{ name: "", value: () => "not a number" }])).toBe(
      0,
    );
    expect(
      sample({ type: "string", enum: ["A", "B"] }, [
        { format: undefined, name: undefined, path: "", value: () => "GONE" },
      ]),
    ).toBe("A");
  });

  it("SAMPLE_SKIP leaves the property out instead of inventing an id", () => {
    // A required id the context cannot supply must stay ABSENT: a placeholder (or
    // a random uuid) points at no resource and turns "field required" into an
    // obscure server error.
    expect(
      sample(
        {
          type: "object",
          required: ["bank_account_id", "type"],
          properties: {
            bank_account_id: { type: "string", format: "uuid" },
            type: { type: "string", const: "SEPA_DEBIT" },
          },
        },
        [{ name: "bank_account_id", value: () => SAMPLE_SKIP }],
      ),
    ).toEqual({ type: "SEPA_DEBIT" });
  });

  it("honours `omit` for a field left to the server's default", () => {
    expect(
      sample(
        {
          type: "object",
          required: ["dates"],
          properties: {
            dates: {
              type: "object",
              required: ["date_of_start", "date_of_end"],
              properties: {
                date_of_start: { type: "string", format: "date" },
                date_of_end: { type: "string", format: "date" },
              },
            },
          },
        },
        undefined,
        { omit: ["dates.date_of_start"] },
      ),
    ).toEqual({ dates: { date_of_end: TODAY } });
  });
});

describe("schemaAtPath", () => {
  const body: JsonSchema = {
    type: "object",
    properties: {
      beneficiary_clause: BENEFICIARY_CLAUSE,
      allocations: {
        type: "object",
        properties: {
          funds: {
            type: "array",
            items: {
              type: "object",
              properties: { rate: { type: "integer" } },
            },
          },
        },
      },
    },
  };

  it("resolves the leaf a seed mapping addresses", () => {
    expect(schemaAtPath(body, "beneficiary_clause.content")).toMatchObject({
      type: "string",
      maxLength: 2000,
    });
    expect(schemaAtPath(body, "allocations.funds[0].rate")).toMatchObject({
      type: "integer",
    });
  });

  it("returns undefined for a path the contract doesn't declare", () => {
    expect(schemaAtPath(body, "nope.deeper")).toBeUndefined();
    expect(schemaAtPath(undefined, "a")).toBeUndefined();
  });
});

describe("coerceToSchema", () => {
  it("fits a context string to the leaf's declared type", () => {
    expect(coerceToSchema("42", { type: "integer" })).toBe(42);
    expect(coerceToSchema("4.5", { type: "number" })).toBe(4.5);
    expect(coerceToSchema("true", { type: "boolean" })).toBe(true);
    expect(coerceToSchema("false", { type: "boolean" })).toBe(false);
    expect(coerceToSchema("abc", { type: "string" })).toBe("abc");
  });

  it("matches an enum member by its string form", () => {
    expect(coerceToSchema("2", { enum: [1, 2, 3] })).toBe(2);
  });

  it("leaves unparseable input alone rather than inventing a 0", () => {
    expect(coerceToSchema("abc", { type: "integer" })).toBe("abc");
    expect(coerceToSchema("", { type: "integer" })).toBe("");
    expect(coerceToSchema("yes", { type: "boolean" })).toBe("yes");
    expect(coerceToSchema("x", undefined)).toBe("x");
  });
});

describe("validateAgainstSchema", () => {
  const contractCreate: JsonSchema = {
    type: "object",
    required: ["product_id"],
    properties: {
      product_id: { type: "string" },
      date_of_effect: { type: "string", format: "date" },
      beneficiary_clause: BENEFICIARY_CLAUSE,
      status: { type: "string", enum: ["DRAFT", "ACCEPTED"] },
    },
  };

  it("catches the v0.0.79 regression: a string where the contract wants an object", () => {
    const issues = validateAgainstSchema(
      { product_id: "p", beneficiary_clause: "Mes héritiers légaux" },
      contractCreate,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "type-mismatch",
      path: "beneficiary_clause",
    });
    expect(issues[0].message).toContain("object");
    expect(issues[0].message).toContain("string");
  });

  it("reports a property the contract no longer declares", () => {
    expect(
      validateAgainstSchema({ product_id: "p", legacy_field: 1 }, contractCreate),
    ).toEqual([
      {
        kind: "unknown-property",
        path: "legacy_field",
        message: expect.stringContaining("absente du contrat"),
      },
    ]);
  });

  it("stays quiet about extras a schema explicitly permits", () => {
    // `additionalProperties` as a SCHEMA permits extras of that type, not just
    // `true` — such a schema was previously reported as forbidding them.
    for (const additionalProperties of [true, { type: "string" } as JsonSchema])
      expect(
        validateAgainstSchema(
          { a: "x", extra: "y" },
          { type: "object", properties: { a: { type: "string" } }, additionalProperties },
        ),
      ).toEqual([]);
  });

  it("reports a string outside the contract's length bounds", () => {
    expect(
      validateAgainstSchema("abc", { type: "string", minLength: 5 }).map(
        (i) => i.kind,
      ),
    ).toEqual(["constraint-violation"]);
    expect(
      validateAgainstSchema("abcdef", { type: "string", maxLength: 3 }).map(
        (i) => i.kind,
      ),
    ).toEqual(["constraint-violation"]);
  });

  it("does not choke on a regex flavour JS cannot compile", () => {
    expect(
      validateAgainstSchema("x", { type: "string", pattern: "(?<broken" }),
    ).toEqual([]);
  });

  it("reports a newly required property", () => {
    expect(
      validateAgainstSchema({}, contractCreate).map((i) => [i.kind, i.path]),
    ).toEqual([["missing-required", "product_id"]]);
  });

  it("reports a value outside an enum", () => {
    const issues = validateAgainstSchema(
      { product_id: "p", status: "GONE" },
      contractCreate,
    );
    expect(issues.map((i) => i.kind)).toEqual(["enum-violation"]);
  });

  it("reports a read-only property, unless it is a const discriminator", () => {
    expect(
      validateAgainstSchema(
        { product_id: "p", beneficiary_clause: { content: "c", date_of_effect: "d", date_of_end: "e" } },
        contractCreate,
      ).map((i) => [i.kind, i.path]),
    ).toEqual([["read-only-property", "beneficiary_clause.date_of_end"]]);
    // `fiscal_type: FRENCH_RESIDENCY` is readOnly AND const: echoing it at its
    // only legal value is harmless and the API has always been given it.
    expect(
      validateAgainstSchema(
        { fiscal_type: "FRENCH_RESIDENCY" },
        {
          type: "object",
          properties: {
            fiscal_type: { type: "string", const: "FRENCH_RESIDENCY", readOnly: true },
          },
        },
      ),
    ).toEqual([]);
  });

  it("recurses into nested objects and array rows", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        funds: {
          type: "array",
          items: {
            type: "object",
            required: ["fund_id"],
            properties: { fund_id: { type: "string" } },
          },
        },
      },
    };
    expect(
      validateAgainstSchema({ funds: [{ fund_id: "f" }, { fund_id: 7 }] }, schema).map(
        (i) => [i.kind, i.path],
      ),
    ).toEqual([["type-mismatch", "funds[1].fund_id"]]);
  });

  it("accepts a value any union branch allows, and null only where nullable", () => {
    const tin: JsonSchema = {
      oneOf: [
        { type: "object", required: ["number"], properties: { number: { type: "string" } } },
        { type: "object", required: ["reason"], properties: { reason: { type: "string" } } },
      ],
    };
    expect(validateAgainstSchema({ reason: "NO_TIN" }, tin)).toEqual([]);
    expect(validateAgainstSchema({ nope: 1 }, tin).map((i) => i.kind)).toEqual([
      "type-mismatch",
    ]);
    expect(
      validateAgainstSchema(null, { oneOf: [{ type: "string" }, { type: "null" }] }),
    ).toEqual([]);
    expect(validateAgainstSchema(null, { type: "string" }).map((i) => i.kind)).toEqual(
      ["type-mismatch"],
    );
  });

  it("finds nothing to report on a body it generated itself", () => {
    expect(
      validateAgainstSchema(sample(contractCreate, undefined, { include: "all" }), contractCreate),
    ).toEqual([]);
  });

  it("says nothing without a schema (an unsynced API is not drift)", () => {
    expect(validateAgainstSchema({ anything: 1 }, undefined)).toEqual([]);
  });
});

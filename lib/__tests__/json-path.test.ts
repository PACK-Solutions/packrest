import { describe, expect, it } from "vitest";
import {
  deepMerge,
  deleteAtPath,
  flattenLeaves,
  formatPath,
  getAtPath,
  isLeafValue,
  parsePath,
  setAtPath,
} from "@/lib/json-path";

describe("parsePath / formatPath", () => {
  it("splits dotted and bracket notation the same way", () => {
    expect(parsePath("beneficiary_clause.content")).toEqual([
      "beneficiary_clause",
      "content",
    ]);
    expect(parsePath("allocations.funds[0].fund_id")).toEqual([
      "allocations",
      "funds",
      0,
      "fund_id",
    ]);
    expect(parsePath("a[0][1]")).toEqual(["a", 0, 1]);
    expect(parsePath("")).toEqual([]);
  });

  it("treats a dotted numeric segment as an object KEY, not an index", () => {
    // Bracket-only indices keep formatPath invertible: it emits object keys bare,
    // so reading a bare `1` as an index turned a map keyed "1" into an array.
    expect(parsePath("headers.1")).toEqual(["headers", "1"]);
    expect(parsePath("1")).toEqual(["1"]);
    expect(parsePath("funds[0]")).toEqual(["funds", 0]);
  });

  it("reads a negative index (the clause in force is the LAST history entry)", () => {
    expect(parsePath("beneficiary_clauses[-1].content")).toEqual([
      "beneficiary_clauses",
      -1,
      "content",
    ]);
  });

  it("round-trips through formatPath, indices in bracket form", () => {
    for (const p of [
      "a",
      "a.b",
      "a.b[0].c",
      "beneficiary_clauses[-1].content",
      "a[0][1]",
      "headers.1",
    ])
      expect(formatPath(parsePath(p))).toBe(p);
  });
});

describe("isLeafValue", () => {
  it("counts primitives and EMPTY containers as leaves", () => {
    for (const v of ["", 0, false, null, undefined, [], {}])
      expect(isLeafValue(v), JSON.stringify(v) ?? "undefined").toBe(true);
    for (const v of [[1], { a: 1 }]) expect(isLeafValue(v)).toBe(false);
  });
});

describe("getAtPath", () => {
  const body = {
    beneficiary_clauses: [
      { content: "ancienne", date_of_effect: "2026-01-01" },
      { content: "en vigueur", date_of_effect: "2027-01-01" },
    ],
    contract: { id: "c-1" },
    zero: 0,
    empty: "",
  };

  it("reads nested and array-indexed values", () => {
    expect(getAtPath(body, "contract.id")).toBe("c-1");
    expect(getAtPath(body, "beneficiary_clauses[0].content")).toBe("ancienne");
    expect(getAtPath(body, "beneficiary_clauses[-1].content")).toBe("en vigueur");
    expect(getAtPath(body, "beneficiary_clauses[-2].content")).toBe("ancienne");
  });

  it("returns falsy values as they are, and undefined for what is absent", () => {
    expect(getAtPath(body, "zero")).toBe(0);
    expect(getAtPath(body, "empty")).toBe("");
    expect(getAtPath(body, "nope")).toBeUndefined();
    expect(getAtPath(body, "contract.nope.deeper")).toBeUndefined();
    expect(getAtPath(body, "beneficiary_clauses[9].content")).toBeUndefined();
    // A numeric OBJECT key is reachable (it used to read as an array index).
    expect(getAtPath({ "1": "a" }, "1")).toBe("a");
    // Indexing an object, or keying an array, resolves to nothing rather than
    // throwing — a producer path against an unexpected response shape.
    expect(getAtPath(body, "contract[0]")).toBeUndefined();
    expect(getAtPath({ a: [] }, "a[-1]")).toBeUndefined();
    expect(getAtPath(null, "a")).toBeUndefined();
  });
});

describe("setAtPath", () => {
  it("creates the intermediate containers a nested seed needs", () => {
    expect(setAtPath({}, "beneficiary_clause.content", "Mes héritiers")).toEqual({
      beneficiary_clause: { content: "Mes héritiers" },
    });
    // An index segment creates an ARRAY, a name segment an object.
    expect(setAtPath({}, "allocations.funds[0].fund_id", "f-1")).toEqual({
      allocations: { funds: [{ fund_id: "f-1" }] },
    });
  });

  it("merges into an existing branch without touching its siblings", () => {
    const before = {
      beneficiary_clause: { content: "old", date_of_effect: "2027-01-01" },
      date_of_effect: "2026-08-05",
    };
    const after = setAtPath(before, "beneficiary_clause.content", "new");
    expect(after).toEqual({
      beneficiary_clause: { content: "new", date_of_effect: "2027-01-01" },
      date_of_effect: "2026-08-05",
    });
    // Immutable: the RequestBuilder holds the previous value in React state.
    expect(before.beneficiary_clause.content).toBe("old");
    expect(after).not.toBe(before);
    expect(after.beneficiary_clause).not.toBe(before.beneficiary_clause);
  });

  it("fills a hole rather than leaving a sparse array (JSON.stringify emits null)", () => {
    const out = setAtPath({}, "funds[2].fund_id", "f-3") as {
      funds: { fund_id?: string }[];
    };
    expect(out.funds).toHaveLength(3);
    expect(out.funds[0]).toEqual({});
    expect(out.funds[2]).toEqual({ fund_id: "f-3" });
    expect(JSON.stringify(out)).not.toContain("null");
  });

  it("replaces a container of the wrong kind (a scalar where an object belongs)", () => {
    // Exactly the v0.0.79 case: the value held a string, the contract now wants
    // an object. The caller decides whether to overwrite; this just writes.
    expect(
      setAtPath({ beneficiary_clause: "Mes héritiers" }, "beneficiary_clause.content", "x"),
    ).toEqual({ beneficiary_clause: { content: "x" } });
  });

  it("resolves a negative index against the current length, 0 when empty", () => {
    expect(setAtPath({ a: [1, 2, 3] }, "a[-1]", 9)).toEqual({ a: [1, 2, 9] });
    expect(setAtPath({}, "a[-1]", 9)).toEqual({ a: [9] });
  });

  it("replaces the root for an empty path", () => {
    expect(setAtPath({ a: 1 }, "", "root")).toBe("root");
  });
});

describe("deleteAtPath", () => {
  it("removes a leaf and splices an array element", () => {
    expect(deleteAtPath({ a: { b: 1, c: 2 } }, "a.b")).toEqual({ a: { c: 2 } });
    expect(deleteAtPath({ a: [1, 2, 3] }, "a[1]")).toEqual({ a: [1, 3] });
    expect(deleteAtPath({ a: [1, 2, 3] }, "a[-1]")).toEqual({ a: [1, 2] });
  });

  it("leaves an absent path (and the original) untouched", () => {
    const before = { a: { b: 1 } };
    expect(deleteAtPath(before, "a.zzz")).toEqual(before);
    expect(deleteAtPath(before, "zzz.b")).toEqual(before);
    expect(before).toEqual({ a: { b: 1 } });
  });
});

describe("flattenLeaves", () => {
  it("keys every leaf by its path", () => {
    expect(
      flattenLeaves({
        date_of_effect: "2026-08-05",
        beneficiary_clause: { content: "Mes héritiers", date_of_effect: "2026-08-06" },
        allocations: { funds: [{ fund_id: "f-1", rate: { value: 100 } }] },
      }),
    ).toEqual({
      date_of_effect: "2026-08-05",
      "beneficiary_clause.content": "Mes héritiers",
      "beneficiary_clause.date_of_effect": "2026-08-06",
      "allocations.funds[0].fund_id": "f-1",
      "allocations.funds[0].rate.value": 100,
    });
  });

  it("treats an EMPTY container as a leaf (a deliberately cleared list)", () => {
    expect(flattenLeaves({ tags: [], meta: {} })).toEqual({ tags: [], meta: {} });
  });

  it("round-trips through setAtPath", () => {
    const body = {
      a: 1,
      b: { c: "x", d: [true, { e: null }] },
      f: [],
    };
    let rebuilt: unknown = {};
    for (const [path, v] of Object.entries(flattenLeaves(body)))
      rebuilt = setAtPath(rebuilt, path, v);
    expect(rebuilt).toEqual(body);
  });

  it("round-trips a map with NUMERIC keys as an object, not an array", () => {
    // The regression: `{headers: {"1": "a"}}` rebuilt as `{headers: [{}, "a"]}`,
    // losing the keys and injecting a hole-filler element.
    const body = { headers: { "1": "a", "2": "b" } };
    let rebuilt: unknown = {};
    for (const [path, v] of Object.entries(flattenLeaves(body)))
      rebuilt = setAtPath(rebuilt, path, v);
    expect(rebuilt).toEqual(body);
  });

  it("gives a top-level primitive no path (callers handle that case)", () => {
    expect(flattenLeaves("raw")).toEqual({});
  });
});

describe("deepMerge", () => {
  it("merges plain objects recursively, later layer winning per leaf", () => {
    expect(
      deepMerge(
        { a: 1, nested: { x: 1, y: 2 } },
        { nested: { y: 99, z: 3 } },
        { a: 2 },
      ),
    ).toEqual({ a: 2, nested: { x: 1, y: 99, z: 3 } });
  });

  it("REPLACES arrays wholesale — an allocation list is only correct as a whole", () => {
    expect(
      deepMerge(
        { allocations: { funds: [{ fund_id: undefined, rate: 1 }] } },
        { allocations: { funds: [{ fund_id: "f-1", rate: 10000000 }] } },
      ),
    ).toEqual({ allocations: { funds: [{ fund_id: "f-1", rate: 10000000 }] } });
  });

  it("refines a generated skeleton with a seed and then an override", () => {
    // The three layers of buildAutoRequest, in order.
    expect(
      deepMerge(
        { product_id: "generated", date_of_effect: "2026-08-05" }, // contract
        { product_id: "prod-1", beneficiary_clause: { content: "Mes héritiers" } }, // seed
        { type_of_fund_source: "OWN_FUNDS" }, // override
      ),
    ).toEqual({
      product_id: "prod-1",
      date_of_effect: "2026-08-05",
      beneficiary_clause: { content: "Mes héritiers" },
      type_of_fund_source: "OWN_FUNDS",
    });
  });

  it("skips `undefined` layers and keys but honours an explicit null", () => {
    expect(deepMerge({ a: 1 }, undefined, { b: undefined })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, { a: null })).toEqual({ a: null });
    expect(deepMerge(undefined, undefined)).toBeUndefined();
  });

  it("lets a scalar or array layer replace an object outright", () => {
    expect(deepMerge({ a: 1 }, "scalar")).toBe("scalar");
    expect(deepMerge({ a: 1 }, [1, 2])).toEqual([1, 2]);
  });
});

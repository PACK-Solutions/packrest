import { describe, expect, it } from "vitest";
import {
  advanceState,
  mergeContextValues,
  type ContextValues,
  type ParcoursDef,
} from "@/lib/parcours";

describe("mergeContextValues", () => {
  it("merges incoming values over the previous ones", () => {
    const prev: ContextValues = { person_id: "p1", contract_id: "c1" };
    expect(mergeContextValues(prev, { premium_id: "prem1" })).toEqual({
      person_id: "p1",
      contract_id: "c1",
      premium_id: "prem1",
    });
  });

  it("clears contract-scoped ids when contract_id changes to a different contract", () => {
    const prev: ContextValues = {
      person_id: "p1",
      payment_method_id: "pm1",
      contract_id: "c1",
      contract_number: "N1",
      premium_id: "prem1",
      periodic_premium_id: "per1",
      sr_contract_id: "src1",
      sr_beneficiary_id: "srb1",
      sr_mandate_id: "srm1",
    };
    const next = mergeContextValues(prev, { contract_id: "c2" });
    expect(next.contract_id).toBe("c2");
    // contract-scoped ids dropped
    expect(next.contract_number).toBeUndefined();
    expect(next.premium_id).toBeUndefined();
    expect(next.periodic_premium_id).toBeUndefined();
    expect(next.sr_contract_id).toBeUndefined();
    expect(next.sr_beneficiary_id).toBeUndefined();
    // non-contract-scoped values survive
    expect(next.person_id).toBe("p1");
    expect(next.payment_method_id).toBe("pm1");
    expect(next.sr_mandate_id).toBe("srm1"); // owned by the payment method
  });

  it("keeps everything when contract_id is unchanged", () => {
    const prev: ContextValues = {
      contract_id: "c1",
      premium_id: "prem1",
    };
    expect(mergeContextValues(prev, { contract_id: "c1" })).toEqual(prev);
  });

  it("does not clear on the first contract_id capture (undefined → set)", () => {
    const prev: ContextValues = { product_id: "prod1", person_id: "p1" };
    const next = mergeContextValues(prev, { contract_id: "c1" });
    expect(next).toEqual({ product_id: "prod1", person_id: "p1", contract_id: "c1" });
  });

  it("never clears a contract-scoped id supplied in the same batch", () => {
    const prev: ContextValues = { contract_id: "c1", premium_id: "prem1" };
    // e.g. an unusual capture that sets both a new contract_id and a fresh
    // contract_number in one go — the incoming value must win, not be dropped.
    const next = mergeContextValues(prev, {
      contract_id: "c2",
      contract_number: "N2",
    });
    expect(next.contract_id).toBe("c2");
    expect(next.contract_number).toBe("N2");
    expect(next.premium_id).toBeUndefined();
  });

  it("clears person_name when person_id changes to a different person", () => {
    const prev: ContextValues = {
      person_id: "p1",
      person_name: "Alice Martin",
      contract_id: "c1",
    };
    const next = mergeContextValues(prev, { person_id: "p2" });
    expect(next.person_id).toBe("p2");
    expect(next.person_name).toBeUndefined();
    // Non-person-scoped values survive.
    expect(next.contract_id).toBe("c1");
  });

  it("keeps person_name when person_id is unchanged or supplied in the batch", () => {
    const prev: ContextValues = { person_id: "p1", person_name: "Alice Martin" };
    expect(mergeContextValues(prev, { person_id: "p1" })).toEqual(prev);
    const next = mergeContextValues(prev, {
      person_id: "p2",
      person_name: "Bob Durand",
    });
    expect(next.person_name).toBe("Bob Durand");
  });
});

describe("advanceState clears stale contract-scoped ids", () => {
  const def: ParcoursDef = {
    id: "test",
    title: "t",
    subtitle: "s",
    steps: [
      { id: "a", phase: "P", apiId: "x", operationId: "opA", title: "A" },
      { id: "b", phase: "P", apiId: "x", operationId: "opB", title: "B" },
    ],
  };

  it("drops premium ids when re-running a step that produces a new contract_id", () => {
    const state = {
      parcoursId: "test",
      values: { contract_id: "c1", premium_id: "prem1" } as ContextValues,
      done: ["a", "b"],
      currentStepId: "a",
      drafts: {},
    };
    const next = advanceState(state, def, "a", { contract_id: "c2" });
    expect(next.values.contract_id).toBe("c2");
    expect(next.values.premium_id).toBeUndefined();
  });
});

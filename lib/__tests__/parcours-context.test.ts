import { describe, expect, it } from "vitest";
import {
  advanceState,
  bodyHasContent,
  buildSeedForStep,
  DEFAULT_BENEFICIARY_CLAUSE,
  defaultContextValues,
  defaultDateOfEffect,
  extractProduced,
  initialState,
  mergeContextValues,
  SOUSCRIPTION_PARCOURS,
  type ContextValues,
  type ParcoursDef,
} from "@/lib/parcours";
import type { ProxyResponse } from "@/lib/http";

const stepById = (id: string) => {
  const step = SOUSCRIPTION_PARCOURS.steps.find((s) => s.id === id);
  if (!step) throw new Error(`unknown step ${id}`);
  return step;
};

const res = (body: unknown, status = 200): ProxyResponse => ({
  status,
  statusText: "OK",
  headers: {},
  body,
  durationMs: 1,
});

// POST /contracts/{id}/submit takes no body, so date_of_effect and
// beneficiary_clause must already be on the DRAFT or submission answers 422
// (« Date of effect / Beneficiary clause is required for submission »). They are
// context values, seeded with a default and captured back from each contract
// response — so an edited value is what the next contract step sends.
describe("contract submission fields", () => {
  it("starts a run with a usable date_of_effect + beneficiary_clause", () => {
    const values = initialState(SOUSCRIPTION_PARCOURS).values;
    expect(values.date_of_effect).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(values.date_of_effect).toBe(defaultDateOfEffect());
    expect(values.beneficiary_clause).toBe(DEFAULT_BENEFICIARY_CLAUSE);
  });

  it("create-contract seeds the context ids plus both submission fields", () => {
    const seed = buildSeedForStep(stepById("create-contract"), {
      ...defaultContextValues(),
      product_id: "prod-1",
      person_id: "p-1",
    });
    expect(seed?.body).toEqual({
      product_id: "prod-1",
      subscriber_id: "p-1",
      date_of_effect: defaultDateOfEffect(),
      beneficiary_clause: DEFAULT_BENEFICIARY_CLAUSE,
    });
  });

  it("update-contract re-sends the CONTEXT value, not the default — a clause typed at creation is not overwritten", () => {
    const edited = "Mon épouse, à défaut mes enfants nés ou à naître.";
    const seed = buildSeedForStep(stepById("update-contract"), {
      ...defaultContextValues(),
      contract_id: "c-1",
      beneficiary_clause: edited,
      date_of_effect: "2027-01-01",
    });
    expect(seed?.params).toEqual({ contract_id: "c-1" });
    expect(seed?.body).toEqual({
      date_of_effect: "2027-01-01",
      beneficiary_clause: edited,
    });
  });

  it("captures back what the contract responses echo, so the update step reuses it", () => {
    const created = extractProduced(
      stepById("create-contract"),
      res({
        id: "c-1",
        date_of_effect: "2027-03-01",
        beneficiary_clause: "Mes enfants, par parts égales.",
      }),
    );
    expect(created).toMatchObject({
      contract_id: "c-1",
      date_of_effect: "2027-03-01",
      beneficiary_clause: "Mes enfants, par parts égales.",
    });
    // A response that echoes neither leaves the context value untouched.
    expect(
      extractProduced(stepById("create-contract"), res({ id: "c-2" })),
    ).toEqual({ contract_id: "c-2" });
  });

  it("seeds nothing when the user deliberately clears a context value", () => {
    const seed = buildSeedForStep(stepById("update-contract"), {
      contract_id: "c-1",
      date_of_effect: "",
      beneficiary_clause: "",
    });
    expect(seed?.params).toEqual({ contract_id: "c-1" });
    expect(seed?.body).toBeUndefined();
  });

  it("keeps the seed stable across calls (the RequestBuilder keys its effect on it)", () => {
    const values = defaultContextValues();
    const a = buildSeedForStep(stepById("update-contract"), values);
    const b = buildSeedForStep(stepById("update-contract"), values);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("submit-contract carries no body (both fields must already be on the DRAFT)", () => {
    const seed = buildSeedForStep(stepById("submit-contract"), {
      contract_id: "c-1",
    });
    expect(seed?.params).toEqual({ contract_id: "c-1" });
    expect(seed?.body).toBeUndefined();
  });

  it("only the update step is opted into the automatic mode among optional steps", () => {
    const autoRunOptional = SOUSCRIPTION_PARCOURS.steps
      .filter((s) => s.optional && s.autoRun)
      .map((s) => s.id);
    expect(autoRunOptional).toEqual(["update-contract"]);
  });
});

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

describe("bodyHasContent", () => {
  it("is false for a body an untouched form serialises", () => {
    expect(bodyHasContent(undefined)).toBe(false);
    expect(bodyHasContent(null)).toBe(false);
    expect(bodyHasContent({})).toBe(false);
  });

  it("is true for a non-empty object, array, or any primitive", () => {
    expect(bodyHasContent({ first_name: "A" })).toBe(true);
    expect(bodyHasContent([1, 2])).toBe(true);
    expect(bodyHasContent("raw string body")).toBe(true);
    expect(bodyHasContent(0)).toBe(true);
  });

  it("treats a body-less unmount snapshot as empty", () => {
    // A snapshot that carries only seeded path params (body lost on remount)
    // must read as empty so it can't overwrite a stored pre-fill body.
    const prefilled = { params: { person_id: "p1" }, body: { iban: "FR" } };
    const unmountSnapshot = { params: { person_id: "p1" }, body: null };
    expect(bodyHasContent(prefilled.body)).toBe(true);
    expect(bodyHasContent(unmountSnapshot.body)).toBe(false);
  });
});

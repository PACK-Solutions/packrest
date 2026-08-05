import { describe, expect, it } from "vitest";
import {
  advanceState,
  bodyHasContent,
  buildSeedForStep,
  DEFAULT_BENEFICIARY_CLAUSE,
  defaultClauseDateOfEffect,
  defaultContextValues,
  defaultDateOfEffect,
  draftWithoutSeededFields,
  extractProduced,
  initialState,
  isFutureDate,
  mergeContextValues,
  migrateContextValues,
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
  it("starts a run with a usable date_of_effect + beneficiary clause", () => {
    const values = initialState(SOUSCRIPTION_PARCOURS).values;
    expect(values.date_of_effect).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(values.date_of_effect).toBe(defaultDateOfEffect());
    expect(values.beneficiary_clause_content).toBe(DEFAULT_BENEFICIARY_CLAUSE);
    // The clause's own date must be STRICTLY later than the request date, or the
    // contract API answers 422 OUT_OF_RANGE — unlike the contract's own, which is
    // today.
    expect(values.beneficiary_clause_date_of_effect).toBe(
      defaultClauseDateOfEffect(),
    );
    expect(isFutureDate(values.beneficiary_clause_date_of_effect)).toBe(true);
    expect(values.beneficiary_clause_date_of_effect).not.toBe(
      values.date_of_effect,
    );
  });

  it("create-contract seeds the context ids plus the submission fields, the clause as an OBJECT", () => {
    const seed = buildSeedForStep(stepById("create-contract"), {
      ...defaultContextValues(),
      product_id: "prod-1",
      person_id: "p-1",
    });
    // The contract requires `content` AND `date_of_effect` whenever the key is
    // present: two path mappings build one whole clause.
    expect(seed?.body).toEqual({
      product_id: "prod-1",
      subscriber_id: "p-1",
      date_of_effect: defaultDateOfEffect(),
      beneficiary_clause: {
        content: DEFAULT_BENEFICIARY_CLAUSE,
        date_of_effect: defaultClauseDateOfEffect(),
      },
    });
  });

  it("update-contract re-sends the CONTEXT value, not the default — a clause typed at creation is not overwritten", () => {
    const edited = "Mon épouse, à défaut mes enfants nés ou à naître.";
    const seed = buildSeedForStep(stepById("update-contract"), {
      ...defaultContextValues(),
      contract_id: "c-1",
      beneficiary_clause_content: edited,
      beneficiary_clause_date_of_effect: "2027-02-01",
      date_of_effect: "2027-01-01",
    });
    expect(seed?.params).toEqual({ contract_id: "c-1" });
    expect(seed?.body).toEqual({
      date_of_effect: "2027-01-01",
      beneficiary_clause: { content: edited, date_of_effect: "2027-02-01" },
    });
  });

  it("captures the clause in force from the beneficiary_clauses HISTORY (last entry)", () => {
    // The clause is written through the singular `beneficiary_clause` but read
    // back only from the array, ordered by date_of_effect ascending.
    const created = extractProduced(
      stepById("create-contract"),
      res({
        id: "c-1",
        date_of_effect: "2027-03-01",
        beneficiary_clauses: [
          { content: "Ancienne clause", date_of_effect: "2026-01-01" },
          { content: "Mes enfants, par parts égales.", date_of_effect: "2027-03-02" },
        ],
      }),
    );
    expect(created).toMatchObject({
      contract_id: "c-1",
      date_of_effect: "2027-03-01",
      beneficiary_clause_content: "Mes enfants, par parts égales.",
    });
    // The clause's own date is deliberately NOT captured: an applied clause's
    // date_of_effect is today or earlier, so re-sending it would 422.
    expect(created.beneficiary_clause_date_of_effect).toBeUndefined();
    // A response that echoes nothing leaves the context values untouched — the
    // 202 path (ACCEPTED contract) carries the pending clause in the embedded SR
    // and leaves the history alone.
    expect(
      extractProduced(stepById("create-contract"), res({ id: "c-2" })),
    ).toEqual({ contract_id: "c-2" });
  });

  it("seeds nothing when the user deliberately clears a context value", () => {
    const seed = buildSeedForStep(stepById("update-contract"), {
      contract_id: "c-1",
      date_of_effect: "",
      beneficiary_clause_content: "",
      beneficiary_clause_date_of_effect: "",
    });
    expect(seed?.params).toEqual({ contract_id: "c-1" });
    expect(seed?.body).toBeUndefined();
  });

  it("omits the clause key entirely when only one of its two leaves is set", () => {
    // A partial clause would be rejected (both are mandatory once the key is
    // present) — but a path seed only writes the leaves it has, so the caller
    // sees exactly what the context holds rather than a silently invalid pair.
    const seed = buildSeedForStep(stepById("update-contract"), {
      contract_id: "c-1",
      beneficiary_clause_content: "Mes héritiers",
    });
    expect(seed?.body).toEqual({
      beneficiary_clause: { content: "Mes héritiers" },
    });
  });

  it("migrates a session persisted when the clause was still a plain string", () => {
    const legacy = { beneficiary_clause: "Mon conjoint" } as ContextValues;
    const migrated = migrateContextValues(legacy);
    expect(migrated.beneficiary_clause_content).toBe("Mon conjoint");
    expect((migrated as Record<string, unknown>).beneficiary_clause).toBeUndefined();
    // A missing (or stale) clause date is refreshed to a future one.
    expect(isFutureDate(migrated.beneficiary_clause_date_of_effect)).toBe(true);
  });

  it("refreshes a clause date left behind by a long session, keeping a valid one", () => {
    const stale = migrateContextValues({
      beneficiary_clause_date_of_effect: "2020-01-01",
    });
    expect(stale.beneficiary_clause_date_of_effect).toBe(
      defaultClauseDateOfEffect(),
    );
    const kept = migrateContextValues({
      beneficiary_clause_date_of_effect: "2099-01-01",
    });
    expect(kept.beneficiary_clause_date_of_effect).toBe("2099-01-01");
  });

  it("never resurrects a clause date the user emptied on purpose", () => {
    // `""` means « don't send this » (buildSeedForStep omits the leaf), and every
    // other context value honours that. Refreshing it on each load would undo the
    // user's edit on every navigation.
    expect(
      migrateContextValues({ beneficiary_clause_date_of_effect: "" })
        .beneficiary_clause_date_of_effect,
    ).toBe("");
    // An ABSENT key still gets a usable default.
    expect(
      migrateContextValues({}).beneficiary_clause_date_of_effect,
    ).toBe(defaultClauseDateOfEffect());
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

describe("draftWithoutSeededFields", () => {
  const periodic = stepById("create-periodic-premium");

  it("drops a stale pre-fill, so the live context values win on return", () => {
    // Snapshot taken while contract A was current — and never edited, so what it
    // holds equals what was seeded. The context now holds B.
    const draft = {
      params: { contract_id: "contract-A" },
      body: { payment_method_id: "pm-A", periodicity: "MONTHLY" },
      seeded: {
        params: { contract_id: "contract-A" },
        body: { payment_method_id: "pm-A" },
      },
    };
    const kept = draftWithoutSeededFields(
      periodic,
      { contract_id: "contract-B", payment_method_id: "pm-B" },
      draft,
    );
    // Both pre-filled fields are gone (the seed re-fills them from the context)…
    expect(kept?.params).toBeUndefined();
    expect(kept?.body).toEqual({ periodicity: "MONTHLY" });
    // …and the RequestBuilder would restore nothing that pins contract A.
    expect(JSON.stringify(kept)).not.toContain("contract-A");
    expect(JSON.stringify(kept)).not.toContain("pm-A");
  });

  it("keeps a draft value the context cannot supply", () => {
    const draft = {
      params: { contract_id: "contract-A" },
      body: { payment_method_id: "pm-A" },
      seeded: {
        params: { contract_id: "contract-A" },
        body: { payment_method_id: "pm-A" },
      },
    };
    // Nothing in the context: the draft is all the form has (`seeded` is dropped
    // from the result — it is bookkeeping, not form content).
    expect(draftWithoutSeededFields(periodic, {}, draft)).toEqual({
      params: draft.params,
      body: draft.body,
    });
    // Only the contract is known: the payment method stays from the draft.
    expect(
      draftWithoutSeededFields(periodic, { contract_id: "contract-B" }, draft),
    ).toEqual({ body: { payment_method_id: "pm-A" } });
  });

  it("drops a pre-seed-recording draft, which is what a stale id needs", () => {
    // No `seeded` (saved by an older build, same session): an edit cannot be told
    // from a stale pre-fill, so the context wins — the original defect this guards.
    expect(
      draftWithoutSeededFields(
        periodic,
        { contract_id: "contract-B" },
        { params: { contract_id: "contract-A" } },
      ),
    ).toEqual({});
  });

  it("passes through a missing draft and a non-object body", () => {
    expect(draftWithoutSeededFields(periodic, { contract_id: "c-1" }, undefined))
      .toBeUndefined();
    // A raw (non-object) body has no keys to strip.
    expect(
      draftWithoutSeededFields(periodic, { contract_id: "c-1" }, {
        body: "raw",
      }),
    ).toEqual({ body: "raw" });
  });

  it("keeps a map with numeric keys as an object", () => {
    // The regression: staleness pruning used to flatten the body to path strings
    // and rebuild it, so `{"1": "a"}` came back as the array `[{}, "a"]` — the
    // body form's MapField accepts any key, including numeric ones.
    const draft = { body: { extra: { "1": "a", "2": "b" } }, seeded: {} };
    expect(
      draftWithoutSeededFields(stepById("create-individual"), {}, draft)?.body,
    ).toEqual({ extra: { "1": "a", "2": "b" } });
  });

  it("keeps array element positions while pruning a stale leaf inside one", () => {
    const step = stepById("create-periodic-premium");
    const draft = {
      body: { allocations: { funds: [{ fund_id: "f-1" }, { fund_id: "f-2" }] } },
      seeded: {},
    };
    expect(
      draftWithoutSeededFields(step, { contract_id: "c-1" }, draft)?.body,
    ).toEqual({
      allocations: { funds: [{ fund_id: "f-1" }, { fund_id: "f-2" }] },
    });
  });

  it("leaves a step with no seed mapping untouched", () => {
    const draft = { body: { first_name: "Alice" } };
    expect(
      draftWithoutSeededFields(stepById("create-individual"), {}, draft),
    ).toEqual(draft);
  });

  it("keeps a value the user typed over, drops the pre-fill left untouched", () => {
    // The snapshot was seeded with the context defaults; the user then replaced
    // the clause's CONTENT. On return, that edit must survive while its untouched
    // sibling date, the untouched contract date and the stale ids are refreshed
    // from the live context — which only works because staleness is compared per
    // leaf path, not per top-level key (the clause is one object carrying both).
    const seededDefault = defaultDateOfEffect();
    const clauseDate = defaultClauseDateOfEffect();
    const draft = {
      body: {
        product_id: "prod-OLD",
        subscriber_id: "person-OLD",
        date_of_effect: seededDefault,
        beneficiary_clause: {
          content: "Mon conjoint survivant",
          date_of_effect: clauseDate,
        },
      },
      seeded: {
        body: {
          product_id: "prod-OLD",
          subscriber_id: "person-OLD",
          date_of_effect: seededDefault,
          "beneficiary_clause.content": DEFAULT_BENEFICIARY_CLAUSE,
          "beneficiary_clause.date_of_effect": clauseDate,
        },
      },
    };
    const kept = draftWithoutSeededFields(
      stepById("create-contract"),
      {
        product_id: "prod-NEW",
        person_id: "person-NEW",
        date_of_effect: seededDefault,
        beneficiary_clause_content: DEFAULT_BENEFICIARY_CLAUSE,
        beneficiary_clause_date_of_effect: clauseDate,
      },
      draft,
    );
    expect(kept?.body).toEqual({
      beneficiary_clause: { content: "Mon conjoint survivant" },
    });
  });

  it("keeps an id the user deliberately pointed elsewhere", () => {
    // The premium was pre-filled with the run's payment method; the user replaced
    // it with a mandate created outside the parcours. Re-entering the step must
    // not silently restore the original one and post against the wrong mandate.
    const kept = draftWithoutSeededFields(
      periodic,
      { contract_id: "c-1", payment_method_id: "pm-run" },
      {
        params: { contract_id: "c-1" },
        body: { payment_method_id: "pm-typed-by-hand" },
        seeded: {
          params: { contract_id: "c-1" },
          body: { payment_method_id: "pm-run" },
        },
      },
    );
    expect(kept?.body).toEqual({ payment_method_id: "pm-typed-by-hand" });
    // The path param was untouched, so it is refreshed from the context.
    expect(kept?.params).toBeUndefined();
  });
});

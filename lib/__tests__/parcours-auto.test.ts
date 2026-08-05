import { describe, expect, it } from "vitest";
import type { ProxyResponse } from "@/lib/http";
import {
  DEFAULT_BENEFICIARY_CLAUSE,
  defaultContextValues,
  extractProduced,
  defaultClauseDateOfEffect,
  SOUSCRIPTION_PARCOURS,
  type ContextValues,
  type ParcoursStep,
} from "@/lib/parcours";
import {
  AUTO_CRS_COUNTRY,
  AUTO_PLAN,
  AUTO_STOP_STEP_ID,
  autoRequestIssues,
  buildAutoDraftForStep,
  buildAutoRequest,
  isoInDays,
  missingSeedParams,
  newAutoSeed,
  optionalAutoSteps,
  randomIdentity,
  runParcoursAuto,
  todayIso,
  type AutoExtras,
  type AutoRunCallbacks,
  type CallOperationFn,
  type LoadBodySchemaFn,
} from "@/lib/parcours-auto";
import type { JsonSchema } from "@/lib/types";
import {
  adultBirthDate,
  frCityPostal,
  frFirstName,
  frLastName,
  frStreetLine,
  randomAmountCents,
} from "@/lib/fake-fields";

const DEF = SOUSCRIPTION_PARCOURS;
const step = (id: string) => {
  const s = DEF.steps.find((x) => x.id === id);
  if (!s) throw new Error(`step ${id} not found`);
  return s;
};

function res(status: number, body: unknown = {}): ProxyResponse {
  return {
    status,
    statusText: String(status),
    headers: {},
    body,
    durationMs: 1,
  };
}

// A ctx as the runner would build it, with a fixed identity for assertions. The
// context always carries the parcours defaults (the page seeds them in
// initialState), so the contract steps find date_of_effect / beneficiary_clause.
function makeCtx(values: ContextValues = {}) {
  return {
    values: { ...defaultContextValues(), ...values },
    identity: {
      firstName: "Test",
      lastName: "Durand",
      birthDate: "1980-01-15",
      fullName: "Test Durand",
    },
    iban: "FR7630006000011234567890189",
    bic: "AGRIFRPP",
    address: { line1: "1 rue de la Paix", postalCode: "75002", city: "Paris" },
  };
}

// Scripted mock for callOperation: records calls, answers by operationId.
function mockCall(
  handlers: Record<string, (n: number) => ProxyResponse | null>,
) {
  const calls: Array<{
    operationId: string;
    apiId: string;
    pathParams?: Record<string, string>;
    body?: object | null;
  }> = [];
  const counts = new Map<string, number>();
  const call: CallOperationFn = async (opts) => {
    calls.push({
      operationId: opts.operationId,
      apiId: opts.apiId,
      pathParams: opts.pathParams,
      body: opts.body,
    });
    const n = counts.get(opts.operationId) ?? 0;
    counts.set(opts.operationId, n + 1);
    const h = handlers[opts.operationId];
    return h ? h(n) : res(200, { id: `${opts.operationId}-id` });
  };
  return { call, calls };
}

function collectingCallbacks() {
  const done: Array<{ id: string; produced: ContextValues; hasDraft: boolean }> =
    [];
  const cb: AutoRunCallbacks = {
    onStepStart: () => {},
    onStepDone: (s, produced, draft) =>
      done.push({ id: s.id, produced, hasDraft: !!draft }),
  };
  return { cb, done };
}

const noAbort = new AbortController().signal;

// --- stub contracts -----------------------------------------------------------
//
// Bodies are now DERIVED from the operation's request schema (lib/schema-sample)
// and valued from the hint registry (lib/parcours-hints); AUTO_PLAN only carries
// what a schema cannot express. So a test that asserts a body must supply the
// contract that body is built from — these mirror the shape of the synced specs
// for the operations under test (required fields only, which is all the generator
// reads by default).
const AMOUNT: JsonSchema = {
  type: "object",
  required: ["value", "scale", "currency"],
  properties: {
    value: { type: "integer" },
    scale: { type: "integer" },
    currency: { type: "string" },
  },
};
// A percentage, not an amount: value + scale and NO currency (10000000 at scale 5
// = 100.00000%). Getting this wrong in the stub is what `autoRequestIssues`
// flagged first — the same check that guards the real contracts at runtime.
const RATE: JsonSchema = {
  type: "object",
  required: ["value", "scale"],
  properties: { value: { type: "integer" }, scale: { type: "integer" } },
};
const ALLOCATIONS: JsonSchema = {
  type: "object",
  required: ["funds"],
  properties: {
    funds: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["fund_id", "allocation_rate"],
        properties: {
          fund_id: { type: "string" },
          allocation_rate: RATE,
        },
      },
    },
  },
};
const TIN: JsonSchema = {
  type: "object",
  required: ["tin_type", "number"],
  properties: {
    tin_type: { type: "string", enum: ["NUMBER", "REASON"] },
    number: { type: "string" },
  },
};

const STUB_SCHEMAS: Record<string, JsonSchema> = {
  createIndividual: {
    type: "object",
    required: ["first_name", "last_name", "birth"],
    properties: {
      first_name: { type: "string" },
      last_name: { type: "string" },
      birth: {
        type: "object",
        required: ["date_of_birth"],
        properties: { date_of_birth: { type: "string", format: "date" } },
      },
    },
  },
  upsertPersonAddressByType: {
    type: "object",
    required: ["line1", "postal_code", "city", "country_code"],
    properties: {
      line1: { type: "string" },
      postal_code: { type: "string" },
      city: { type: "string" },
      country_code: { type: "string" },
    },
  },
  upsertPersonFrenchResidency: {
    type: "object",
    required: ["fiscal_type"],
    properties: {
      // readOnly + const, exactly as the synced spec declares it: the generator
      // omits it and AUTO_PLAN supplies the discriminator explicitly.
      fiscal_type: { type: "string", const: "FRENCH_RESIDENCY", readOnly: true },
    },
  },
  upsertPersonFatca: {
    type: "object",
    required: ["tax_identification_number"],
    properties: {
      fiscal_type: { type: "string", const: "FATCA" },
      tax_identification_number: TIN,
      is_pre_existing_contract: { type: "boolean" },
      us_indicia: { type: "array", items: { type: "string" } },
    },
  },
  upsertPersonCrsByCountry: {
    type: "object",
    required: ["tax_identification_number"],
    properties: {
      fiscal_type: { type: "string", const: "CRS" },
      tax_identification_number: TIN,
      is_self_certification_present: { type: "boolean" },
      date_of_self_certification: { type: "string", format: "date" },
    },
  },
  createBankAccount: {
    type: "object",
    required: ["account_holder_name", "iban", "bic", "currency", "date_of_validity_start"],
    properties: {
      account_holder_name: { type: "string" },
      iban: { type: "string" },
      bic: { type: "string" },
      currency: { type: "string" },
      date_of_validity_start: { type: "string", format: "date" },
    },
  },
  createPaymentMethod: {
    type: "object",
    required: ["type", "bank_account_id", "mandate_type", "date_of_validity_start"],
    properties: {
      type: { type: "string", const: "SEPA_DEBIT" },
      bank_account_id: { type: "string" },
      mandate_type: { type: "string", enum: ["RECURRENT", "ONE_OFF"] },
      date_of_validity_start: { type: "string", format: "date" },
    },
  },
  createContract: {
    type: "object",
    required: ["product_id"],
    properties: {
      product_id: { type: "string" },
      subscriber_id: { type: "string" },
      date_of_effect: { type: "string", format: "date" },
      beneficiary_clause: {
        type: "object",
        required: ["content", "date_of_effect"],
        properties: {
          content: { type: "string" },
          date_of_effect: { type: "string", format: "date" },
          date_of_end: { type: "string", format: "date", readOnly: true },
        },
      },
    },
  },
  createPremium: {
    type: "object",
    required: ["amount", "payment_method_id", "type_of_fund_source", "allocations"],
    properties: {
      amount: AMOUNT,
      payment_method_id: { type: "string" },
      type_of_fund_source: { type: "string", enum: ["OWN_FUNDS", "TRANSFER"] },
      allocations: ALLOCATIONS,
    },
  },
  createPeriodicPremium: {
    type: "object",
    required: [
      "periodic_amount",
      "periodicity",
      "payment_method_id",
      "type_of_fund_source",
      "allocations",
      "dates",
    ],
    properties: {
      periodic_amount: AMOUNT,
      periodicity: { type: "string", enum: ["MONTHLY", "QUARTERLY"] },
      payment_method_id: { type: "string" },
      type_of_fund_source: { type: "string", enum: ["OWN_FUNDS", "TRANSFER"] },
      allocations: ALLOCATIONS,
      dates: {
        type: "object",
        properties: {
          date_of_start: { type: "string", format: "date" },
          date_of_end: { type: "string", format: "date" },
        },
      },
    },
  },
};

/** The request schema for a step, as `loadStepBodySchema` would resolve it. */
function stubSchema(s: ParcoursStep): JsonSchema | undefined {
  return STUB_SCHEMAS[s.operationId];
}

const stubLoader: LoadBodySchemaFn = async (s) => stubSchema(s);

/** `buildAutoRequest` with the step's stub contract wired in. */
function buildWithSchema(
  s: ParcoursStep,
  ctx: ReturnType<typeof makeCtx>,
  extras: AutoExtras = {},
) {
  return buildAutoRequest(s, ctx, { ...extras, bodySchema: stubSchema(s) });
}

// --- generators ---------------------------------------------------------------

describe("fake-fields generators", () => {
  it("adultBirthDate stays within 18–80 years", () => {
    for (let i = 0; i < 50; i++) {
      const iso = adultBirthDate();
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const age =
        (Date.now() - new Date(iso).getTime()) / (365.25 * 24 * 3600 * 1000);
      expect(age).toBeGreaterThanOrEqual(17.9);
      expect(age).toBeLessThanOrEqual(80.1);
    }
  });

  it("names / street / city-postal are non-empty and plausible", () => {
    expect(frFirstName()).toBeTruthy();
    expect(frLastName()).toBeTruthy();
    expect(frStreetLine()).toMatch(/^\d+ (rue|avenue|boulevard) /);
    const { city, postalCode } = frCityPostal();
    expect(city).toBeTruthy();
    expect(postalCode).toMatch(/^\d{5}$/);
  });

  it("randomAmountCents is a whole-euro amount within range", () => {
    for (let i = 0; i < 50; i++) {
      const cents = randomAmountCents(1000, 10000);
      expect(cents).toBeGreaterThanOrEqual(100_000);
      expect(cents).toBeLessThanOrEqual(1_000_000);
      expect(cents % 100).toBe(0);
    }
  });

  it("randomIdentity varies across draws", () => {
    const names = new Set(
      Array.from({ length: 50 }, () => randomIdentity().fullName),
    );
    expect(names.size).toBeGreaterThan(1);
    const one = randomIdentity();
    expect(one.fullName).toBe(`${one.firstName} ${one.lastName}`);
  });
});

// --- buildAutoRequest -----------------------------------------------------------

describe("buildAutoRequest", () => {
  it("create-individual carries the identity, derived from the contract", () => {
    // No AUTO_PLAN body at all: every field here comes from IndividualCreate's
    // required set, valued by the hint registry — including the nested
    // `birth.date_of_birth` the contract nests one level down.
    const ctx = makeCtx();
    const { pathParams, body } = buildWithSchema(step("create-individual"), ctx);
    expect(pathParams).toEqual({});
    expect(body).toEqual({
      first_name: "Test",
      last_name: "Durand",
      birth: { date_of_birth: "1980-01-15" },
    });
    expect(AUTO_PLAN["create-individual"].body).toBeUndefined();
  });

  it("person-address merges seed path params with the random address", () => {
    const ctx = makeCtx({ person_id: "p-1" });
    const { pathParams, body } = buildWithSchema(step("person-address"), ctx);
    expect(pathParams).toEqual({ person_id: "p-1", address_type: "PRINCIPAL" });
    expect(body).toEqual({
      line1: "1 rue de la Paix",
      postal_code: "75002",
      city: "Paris",
      country_code: "FR",
    });
  });

  it("sends nothing derived when the step has no contract to derive from", () => {
    // An unsynced API (or a body-less operation) leaves the seed and the
    // overrides in charge, exactly as before bodies were generated.
    const ctx = makeCtx();
    expect(buildAutoRequest(step("create-individual"), ctx).body).toBeNull();
  });

  it("the bank account carries the IBAN/BIC, the payment method only its id", () => {
    const ctx = makeCtx({
      person_id: "p-1",
      person_name: "Test Durand",
      bank_account_id: "ba-1",
    });
    const bank = buildWithSchema(step("person-bank-account"), ctx);
    const pm = buildWithSchema(step("create-payment-method"), ctx);
    expect(bank.body).toMatchObject({
      account_holder_name: "Test Durand",
      iban: ctx.iban,
      // Required by the person API on creation.
      bic: ctx.bic,
      currency: "EUR",
      date_of_validity_start: todayIso(),
    });
    // PaymentMethodCreate requires bank_account_id and defines no iban/bic:
    // the bank details live on the account the payment method references.
    expect(pm.body).toEqual({
      type: "SEPA_DEBIT",
      bank_account_id: "ba-1",
      mandate_type: "RECURRENT",
      date_of_validity_start: todayIso(),
    });
  });

  it("captures the bank account id the payment method needs", () => {
    // The 400 this guards: « Field 'bank_account_id' is required ».
    expect(
      extractProduced(
        step("person-bank-account"),
        res(201, { id: "ba-created" }),
      ),
    ).toEqual({ bank_account_id: "ba-created" });
    // Without it in the context the seed omits it rather than sending "".
    const { body } = buildWithSchema(
      step("create-payment-method"),
      makeCtx({ person_id: "p-1" }),
    );
    expect(body).not.toHaveProperty("bank_account_id");
  });

  it("person-submit has no body, only the path param", () => {
    const ctx = makeCtx({ person_id: "p-1" });
    const { pathParams, body } = buildAutoRequest(step("person-submit"), ctx);
    expect(pathParams).toEqual({ person_id: "p-1" });
    expect(body).toBeNull();
  });

  it("create-contract seeds product/subscriber and the submit-required fields, the clause as an OBJECT", () => {
    // The regression this guards: v0.0.79 turned `beneficiary_clause` from a
    // string into `{content, date_of_effect}`. Both leaves are seeded by path, the
    // clause's own date is strictly in the future (a same-day one is 422
    // OUT_OF_RANGE), and the readOnly `date_of_end` is never sent.
    const ctx = makeCtx({ product_id: "prod-1", person_id: "p-1" });
    const { body } = buildWithSchema(step("create-contract"), ctx);
    expect(body).toMatchObject({
      product_id: "prod-1",
      subscriber_id: "p-1",
      date_of_effect: todayIso(),
      beneficiary_clause: {
        content: DEFAULT_BENEFICIARY_CLAUSE,
        date_of_effect: defaultClauseDateOfEffect(),
      },
    });
    expect(defaultClauseDateOfEffect() > todayIso()).toBe(true);
    expect(body?.beneficiary_clause).not.toHaveProperty("date_of_end");
    // And it fits the contract — the check that would have caught the drift.
    expect(
      autoRequestIssues(body, stubSchema(step("create-contract"))),
    ).toEqual([]);
  });

  it("reports drift instead of silently sending a body the contract rejects", () => {
    // Simulate the v0.0.79 change landing while the code still sent a string:
    // the contract says object, the body says string.
    const stringClause = { product_id: "p", beneficiary_clause: "Mes héritiers" };
    const issues = autoRequestIssues(
      stringClause,
      stubSchema(step("create-contract")),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "type-mismatch",
      path: "beneficiary_clause",
    });
    expect(issues[0].message).toContain("object");
  });

  it("create-premium: 100% on the picked fund, cents amount, seeded payment method", () => {
    const ctx = makeCtx({ contract_id: "c-1", payment_method_id: "pm-1" });
    const { pathParams, body } = buildWithSchema(step("create-premium"), ctx, {
      fundId: "fund-42",
    });
    expect(pathParams).toEqual({ contract_id: "c-1" });
    expect(body).toMatchObject({
      payment_method_id: "pm-1",
      allocations: {
        funds: [
          { fund_id: "fund-42", allocation_rate: { value: 10000000, scale: 5 } },
        ],
      },
    });
    const amount = (body as { amount: { value: number; scale: number; currency: string } })
      .amount;
    expect(amount.scale).toBe(2);
    expect(amount.currency).toBe("EUR");
    expect(amount.value % 100).toBe(0);
  });

  it("person-fatca declares the TIN the FATCA record requires", () => {
    const ctx = makeCtx({ person_id: "p-1" });
    const { pathParams, body } = buildWithSchema(step("person-fatca"), ctx);
    expect(pathParams).toEqual({ person_id: "p-1" });
    expect(body).toMatchObject({
      fiscal_type: "FATCA",
      tax_identification_number: { tin_type: "NUMBER" },
    });
    const tin = (body as { tax_identification_number: { number: string } })
      .tax_identification_number;
    expect(tin.number).toMatch(/^\d{9}$/);
  });

  it("person-crs carries the country_code path param no context key feeds", () => {
    const ctx = makeCtx({ person_id: "p-1" });
    const { pathParams, body } = buildWithSchema(step("person-crs"), ctx);
    // The CRS record is keyed by country: supplied by the plan, not by `seedFrom`.
    expect(pathParams).toEqual({
      person_id: "p-1",
      country_code: AUTO_CRS_COUNTRY,
    });
    expect(body).toMatchObject({
      fiscal_type: "CRS",
      is_self_certification_present: true,
      date_of_self_certification: todayIso(),
    });
    // The country belongs to the path only (CRSCreate forbids extra properties).
    expect(body).not.toHaveProperty("country_code");
  });

  it("create-periodic-premium: monthly instalment, one fund, server-defaulted start", () => {
    const ctx = makeCtx({ contract_id: "c-1", payment_method_id: "pm-1" });
    const { pathParams, body } = buildWithSchema(
      step("create-periodic-premium"),
      ctx,
      { fundId: "fund-7" },
    );
    expect(pathParams).toEqual({ contract_id: "c-1" });
    expect(body).toMatchObject({
      type_of_fund_source: "OWN_FUNDS",
      payment_method_id: "pm-1",
      periodicity: "MONTHLY",
      allocations: {
        funds: [
          { fund_id: "fund-7", allocation_rate: { value: 10000000, scale: 5 } },
        ],
      },
    });
    const { dates, periodic_amount: amount } = body as {
      dates: { date_of_start?: string; date_of_end: string };
      periodic_amount: { value: number; scale: number; currency: string };
    };
    // No date_of_start: the API defaults it at acceptance to
    // max(date_of_effect, date_of_acceptance) + 30 days, i.e. just outside the
    // renunciation window. Any value computed here is validated against that
    // window whenever the decision lands, so a late decision would fail it.
    expect(dates.date_of_start).toBeUndefined();
    expect(dates.date_of_end > todayIso()).toBe(true);
    expect(amount).toMatchObject({ scale: 2, currency: "EUR" });
    expect(amount.value % 100).toBe(0);
  });

  it("never sends a date_of_start, whatever date_of_effect holds", () => {
    // A future date of effect used to shift a computed start date; the field is
    // now the server's business, so the context value can't put it in the window.
    const ctx = makeCtx({
      contract_id: "c-1",
      payment_method_id: "pm-1",
      date_of_effect: isoInDays(180),
    });
    const { body } = buildWithSchema(step("create-periodic-premium"), ctx, {
      fundId: "fund-7",
    });
    expect((body as { dates: Record<string, unknown> }).dates).not.toHaveProperty(
      "date_of_start",
    );
  });
});

// --- optionalAutoSteps / missingSeedParams ---------------------------------------

describe("optionalAutoSteps", () => {
  it("lists the optional steps except those that always run", () => {
    const ids = optionalAutoSteps(DEF).map((s) => s.id);
    // update-contract is optional but declares autoRun — it is never a choice.
    expect(ids).not.toContain("update-contract");
    expect(ids).toEqual([
      "person-address-correspondence",
      "person-address-fiscal",
      "person-fatca",
      "person-crs",
      "update-premium",
      "create-periodic-premium",
      "update-periodic-premium",
    ]);
  });

  it("never offers a step beyond the documents stop", () => {
    const stopIdx = DEF.steps.findIndex((s) => s.id === AUTO_STOP_STEP_ID);
    for (const s of optionalAutoSteps(DEF))
      expect(DEF.steps.findIndex((x) => x.id === s.id)).toBeLessThan(stopIdx);
  });

  it("every selectable optional step builds a non-empty request", () => {
    // A ticked step must never fire an empty body the API would 422 on. What
    // guarantees that is now the CONTRACT plus the step's overrides, not an
    // AUTO_PLAN entry — several optional steps legitimately have no override left
    // (the two extra address variants derive entirely from AddressCreate).
    const ctx = makeCtx({
      person_id: "p-1",
      payment_method_id: "pm-1",
      contract_id: "c-1",
      premium_id: "prem-1",
      periodic_premium_id: "pp-1",
    });
    for (const s of optionalAutoSteps(DEF)) {
      const { body } = buildWithSchema(s, ctx, { fundId: "fund-1" });
      expect(body, `${s.id} builds an empty body`).not.toBeNull();
      expect(Object.keys(body ?? {}).length, s.id).toBeGreaterThan(0);
    }
  });

  it("keeps every override in AUTO_PLAN consistent with its contract", () => {
    // The overrides are the only hand-written part left, so they are the only
    // part that can silently fall behind. Each stub schema here mirrors the
    // synced spec, and the validator must find nothing to report.
    const ctx = makeCtx({
      person_id: "p-1",
      product_id: "prod-1",
      payment_method_id: "pm-1",
      bank_account_id: "ba-1",
      contract_id: "c-1",
      premium_id: "prem-1",
      periodic_premium_id: "pp-1",
    });
    for (const s of DEF.steps) {
      const schema = stubSchema(s);
      if (!schema) continue; // no stub contract for this operation
      const { body } = buildWithSchema(s, ctx, { fundId: "fund-1" });
      expect(autoRequestIssues(body, schema), s.id).toEqual([]);
    }
  });
});

describe("missingSeedParams", () => {
  it("reports the path params the context can't fill", () => {
    expect(missingSeedParams(step("update-periodic-premium"), {})).toEqual([
      "contract_id",
      "periodic_premium_id",
    ]);
    expect(
      missingSeedParams(step("update-periodic-premium"), {
        contract_id: "c-1",
        periodic_premium_id: "pp-1",
      }),
    ).toEqual([]);
  });

  it("ignores const seeds and body seeds", () => {
    // address_type is a const param, payment_method_id a body seed.
    expect(
      missingSeedParams(step("person-address-correspondence"), { person_id: "p-1" }),
    ).toEqual([]);
    expect(
      missingSeedParams(step("create-periodic-premium"), { contract_id: "c-1" }),
    ).toEqual([]);
  });
});

// --- buildAutoDraftForStep ------------------------------------------------------

describe("buildAutoDraftForStep", () => {
  const seed = {
    identity: {
      firstName: "Test",
      lastName: "Durand",
      birthDate: "1980-01-15",
      fullName: "Test Durand",
    },
    iban: "FR7630006000011234567890189",
    bic: "AGRIFRPP",
    address: { line1: "1 rue de la Paix", postalCode: "75002", city: "Paris" },
  };

  it("shapes a create-individual draft as {body} only (no params)", () => {
    const draft = buildAutoDraftForStep(step("create-individual"), seed, {}, {
      bodySchema: stubSchema(step("create-individual")),
    });
    expect(draft).toEqual({
      body: {
        first_name: "Test",
        last_name: "Durand",
        birth: { date_of_birth: "1980-01-15" },
      },
    });
    expect(draft?.params).toBeUndefined();
  });

  it("carries both params and body for person-address", () => {
    const draft = buildAutoDraftForStep(
      step("person-address"),
      seed,
      { person_id: "p-1" },
      { bodySchema: stubSchema(step("person-address")) },
    );
    expect(draft?.params).toEqual({
      person_id: "p-1",
      address_type: "PRINCIPAL",
    });
    expect(draft?.body).toMatchObject({ country_code: "FR" });
  });

  it("returns null when a step has nothing to pre-fill", () => {
    // No plan body (submitting takes none), and its only seed param (person_id)
    // is absent from the context.
    expect(buildAutoDraftForStep(step("person-submit"), seed, {})).toBeNull();
  });

  it("pre-fills an optional step that has an auto plan (FATCA)", () => {
    // Optional steps now carry a plan body too, so semi mode pre-fills them —
    // the user still reviews, then executes or presses « Passer ».
    const draft = buildAutoDraftForStep(
      step("person-fatca"),
      seed,
      { person_id: "p-1" },
      { bodySchema: stubSchema(step("person-fatca")) },
    );
    expect(draft?.params).toEqual({ person_id: "p-1" });
    expect(draft?.body).toMatchObject({ fiscal_type: "FATCA" });
  });

  it("newAutoSeed reuses the IBAN and BIC from a prior bank-account draft", () => {
    // Resuming between person-bank-account and create-payment-method must keep
    // the SEPA mandate on the very account the bank-account step registered —
    // for the BIC too, now that the bank account carries one.
    const s = newAutoSeed({
      "person-bank-account": {
        body: { iban: "FR0012345678901234567890123", bic: "CMCIFR2A" },
      },
    });
    expect(s.iban).toBe("FR0012345678901234567890123");
    expect(s.bic).toBe("CMCIFR2A");
    expect(s.identity.fullName).toBe(
      `${s.identity.firstName} ${s.identity.lastName}`,
    );
  });
});

// --- runner ---------------------------------------------------------------------

describe("runParcoursAuto", () => {
  const happyHandlers: Record<string, (n: number) => ProxyResponse | null> = {
    createIndividual: () => res(201, { id: "p-1" }),
    upsertPersonAddressByType: () => res(200, {}),
    upsertPersonFrenchResidency: () => res(200, {}),
    createBankAccount: () => res(201, { id: "ba-1" }),
    submitPerson: () => res(200, {}),
    createPaymentMethod: () =>
      res(201, {
        payment_method_id: "pm-1",
        rum: "RUM-1",
        _embedded: {
          service_requests: [{ id: "sr-m-1", type: "SEPA_MANDATE_SIGNATURE" }],
        },
      }),
    listProducts: () => res(200, { products: [{ id: "prod-1", name: "P" }] }),
    listProductFunds: () => res(200, { funds: [{ id: "fund-1", name: "F" }] }),
    createContract: () => res(201, { id: "c-1" }),
    createPremium: () => res(201, { id: "prem-1" }),
    // Optional steps: only called when the run opts into them.
    upsertPersonFatca: () => res(200, {}),
    upsertPersonCrsByCountry: () => res(200, {}),
    updatePremium: () => res(200, { id: "prem-1" }),
    createPeriodicPremium: () => res(201, { id: "pp-1" }),
    updatePeriodicPremium: () => res(200, { id: "pp-1" }),
    submitContract: () =>
      res(200, {
        contract_number: "K-123",
        _embedded: {
          service_requests: [{ id: "sr-c-1", type: "CONTRACT_SUBSCRIPTION" }],
        },
      }),
  };

  it("runs Phase A + A bis, skips optionals, pauses at the product picker", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb, done } = collectingCallbacks();
    const result = await runParcoursAuto(DEF, { values: defaultContextValues(), done: [] }, noAbort, cb, call);

    expect(result.kind).toBe("paused-picker");
    if (result.kind === "paused-picker") {
      expect(result.stepId).toBe("list-products");
    }
    // Optional steps were marked done without any call.
    const optionalIds = DEF.steps.filter((s) => s.optional).map((s) => s.id);
    for (const id of ["person-address-correspondence", "person-fatca", "person-crs"]) {
      expect(optionalIds).toContain(id);
      expect(done.some((d) => d.id === id && !d.hasDraft)).toBe(true);
    }
    // list-products stays NOT done (the user must confirm the pick).
    expect(done.some((d) => d.id === "list-products")).toBe(false);
    // Calls in parcours order, no optional operation ran twice.
    expect(calls.map((c) => c.operationId)).toEqual([
      "createIndividual",
      "upsertPersonAddressByType",
      "upsertPersonFrenchResidency",
      "createBankAccount",
      "submitPerson",
      "createPaymentMethod",
      "listProducts",
    ]);
    // person_name captured alongside person_id.
    const created = done.find((d) => d.id === "create-individual");
    expect(created?.produced.person_id).toBe("p-1");
    expect(created?.produced.person_name).toBeTruthy();
    // Executed steps carry a draft of the sent request.
    expect(created?.hasDraft).toBe(true);
  });

  it("resumes after the product pick and stops at the documents step", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb, done } = collectingCallbacks();
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "list-products") + 1)
      .map((s) => s.id);
    const result = await runParcoursAuto(
      DEF,
      {
        values: {
          ...defaultContextValues(),
          person_id: "p-1",
          person_name: "Test Durand",
          payment_method_id: "pm-1",
          product_id: "prod-1",
        },
        done: doneIds,
      },
      noAbort,
      cb,
      call,
    );

    expect(result.kind).toBe("reached-documents");
    expect(calls.map((c) => c.operationId)).toEqual([
      "createContract",
      "updateContract",
      "listProductFunds",
      "createPremium",
      "submitContract",
    ]);
    // update-contract is optional, yet it runs unticked (its `autoRun`) and
    // completes the DRAFT with the fields the submit endpoint requires.
    const update = calls.find((c) => c.operationId === "updateContract");
    expect(update?.pathParams).toEqual({ contract_id: "c-1" });
    expect(update?.body).toMatchObject({
      date_of_effect: todayIso(),
      // End to end through the runner: the clause goes out as the object the
      // contract requires, with its own strictly-future date_of_effect.
      beneficiary_clause: {
        content: DEFAULT_BENEFICIARY_CLAUSE,
        date_of_effect: defaultClauseDateOfEffect(),
      },
    });
    // The premium carries the fund source required at submission.
    const premium = calls.find((c) => c.operationId === "createPremium");
    expect((premium?.body as Record<string, unknown>).type_of_fund_source).toBe(
      "OWN_FUNDS",
    );
    // No Phase C/D operation was touched.
    expect(calls.some((c) => c.apiId === "service-request")).toBe(false);
    const submitted = done.find((d) => d.id === "submit-contract");
    expect(submitted?.produced).toMatchObject({
      contract_number: "K-123",
      sr_contract_id: "sr-c-1",
    });
  });

  it("executes the optional steps the run opted into, and only those", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      {
        values: defaultContextValues(),
        done: [],
        autoOptional: ["person-fatca"],
      },
      noAbort,
      cb,
      call,
    );

    expect(result.kind).toBe("paused-picker");
    const fatca = calls.filter((c) => c.operationId === "upsertPersonFatca");
    expect(fatca).toHaveLength(1);
    expect(fatca[0].pathParams).toEqual({ person_id: "p-1" });
    expect((fatca[0].body as Record<string, unknown>).fiscal_type).toBe("FATCA");
    // The optional steps left unticked never fired — including the two extra
    // addresses, so the principal one is still the only address posted.
    expect(calls.some((c) => c.operationId === "upsertPersonCrsByCountry")).toBe(
      false,
    );
    expect(
      calls.filter((c) => c.operationId === "upsertPersonAddressByType"),
    ).toHaveLength(1);
  });

  it("chains the optional premium steps on the ids the same run produced", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "list-products") + 1)
      .map((s) => s.id);
    const result = await runParcoursAuto(
      DEF,
      {
        values: {
          ...defaultContextValues(),
          person_id: "p-1",
          payment_method_id: "pm-1",
          product_id: "prod-1",
        },
        done: doneIds,
        autoOptional: [
          "update-premium",
          "create-periodic-premium",
          "update-periodic-premium",
        ],
      },
      noAbort,
      cb,
      call,
    );

    expect(result.kind).toBe("reached-documents");
    // The fund catalogue is fetched ONCE for the run, not once per premium step.
    expect(calls.map((c) => c.operationId)).toEqual([
      "createContract",
      "updateContract",
      "listProductFunds",
      "createPremium",
      "updatePremium",
      "createPeriodicPremium",
      "updatePeriodicPremium",
      "submitContract",
    ]);
    // Each edit step targets the id its creation step produced within the run.
    expect(
      calls.find((c) => c.operationId === "updatePremium")?.pathParams,
    ).toEqual({ contract_id: "c-1", premium_id: "prem-1" });
    expect(
      calls.find((c) => c.operationId === "updatePeriodicPremium")?.pathParams,
    ).toEqual({ contract_id: "c-1", periodic_premium_id: "pp-1" });
    // Both premiums allocate onto the SAME fund — picked once for the run.
    const periodic = calls.find((c) => c.operationId === "createPeriodicPremium");
    expect(periodic?.body).toMatchObject({
      periodicity: "MONTHLY",
      allocations: { funds: [{ fund_id: "fund-1" }] },
    });
    const initial = calls.find((c) => c.operationId === "createPremium");
    expect(initial?.body).toMatchObject({
      allocations: { funds: [{ fund_id: "fund-1" }] },
    });
  });

  it("skips an opted-in optional step whose prerequisite id is missing", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb, done } = collectingCallbacks();
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "list-products") + 1)
      .map((s) => s.id);
    // « Modifier le versement périodique » ticked, but its creation step was not:
    // no periodic_premium_id exists, so the request would carry an empty segment.
    const result = await runParcoursAuto(
      DEF,
      {
        values: {
          ...defaultContextValues(),
          person_id: "p-1",
          payment_method_id: "pm-1",
          product_id: "prod-1",
        },
        done: doneIds,
        autoOptional: ["update-periodic-premium"],
      },
      noAbort,
      cb,
      call,
    );

    expect(result.kind).toBe("reached-documents");
    expect(calls.some((c) => c.operationId === "updatePeriodicPremium")).toBe(
      false,
    );
    // NOT reported done: the user asked for this step, so claiming it completed
    // when nothing was sent would be a lie — the stepper keeps it pending, and
    // the run carries on to the end regardless.
    expect(done.some((d) => d.id === "update-periodic-premium")).toBe(false);
    expect(calls.some((c) => c.operationId === "submitContract")).toBe(true);
  });

  it("never replays a ticked optional step that is already done", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    // A run always pauses at the product picker, so resuming is the norm — and
    // the resume pass must not POST the Phase A optional steps a second time
    // (upsert or not, a duplicate write is visible and can open an unwanted
    // ADDRESS_CHANGE demand once the person is ENGAGED). Ticking a step again in
    // the panel is what un-completes it (the page's `toggleAutoOptional`); the
    // runner itself never decides to replay.
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "list-products") + 1)
      .map((s) => s.id);
    const result = await runParcoursAuto(
      DEF,
      {
        values: {
          ...defaultContextValues(),
          person_id: "p-1",
          payment_method_id: "pm-1",
          product_id: "prod-1",
        },
        done: doneIds,
        autoOptional: [
          "person-address-correspondence",
          "person-address-fiscal",
          "person-fatca",
          "person-crs",
        ],
      },
      noAbort,
      cb,
      call,
    );
    expect(result.kind).toBe("reached-documents");
    for (const op of [
      "upsertPersonAddressByType",
      "upsertPersonFatca",
      "upsertPersonCrsByCountry",
    ])
      expect(calls.some((c) => c.operationId === op)).toBe(false);
  });

  it("runs a ticked optional step the panel un-completed", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    // What `toggleAutoOptional` leaves behind: the id ticked AND dropped from
    // `done`, so the next launch reaches the step exactly once.
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "list-products") + 1)
      .map((s) => s.id)
      .filter((id) => id !== "person-fatca");
    const result = await runParcoursAuto(
      DEF,
      {
        values: {
          ...defaultContextValues(),
          person_id: "p-1",
          payment_method_id: "pm-1",
          product_id: "prod-1",
        },
        done: doneIds,
        autoOptional: ["person-fatca"],
      },
      noAbort,
      cb,
      call,
    );
    expect(result.kind).toBe("reached-documents");
    const fatca = calls.filter((c) => c.operationId === "upsertPersonFatca");
    expect(fatca).toHaveLength(1);
    expect(fatca[0].pathParams).toEqual({ person_id: "p-1" });
    // Everything else that was done stays skipped.
    expect(calls.some((c) => c.operationId === "createIndividual")).toBe(false);
    expect(calls.some((c) => c.operationId === "upsertPersonCrsByCountry")).toBe(
      false,
    );
  });

  it("does not duplicate a ticked creating step whose output already exists", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    // The retry must not defeat `skipIfPresent`: a periodic premium already
    // captured means re-running the step would create a second one.
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "submit-contract"))
      .map((s) => s.id);
    await runParcoursAuto(
      DEF,
      {
        values: {
          ...defaultContextValues(),
          person_id: "p-1",
          payment_method_id: "pm-1",
          product_id: "prod-1",
          contract_id: "c-1",
          premium_id: "prem-1",
          periodic_premium_id: "pp-1",
        },
        done: doneIds,
        autoOptional: ["create-periodic-premium"],
      },
      noAbort,
      cb,
      call,
    );
    expect(calls.some((c) => c.operationId === "createPeriodicPremium")).toBe(
      false,
    );
  });

  it("skips a ticked optional premium when the product has no fund, without aborting", async () => {
    const { call, calls } = mockCall({
      ...happyHandlers,
      listProductFunds: () => res(200, { funds: [] }),
      // The mandatory premium is already done and its id captured, so the run
      // reaches the optional periodic premium — which cannot get a fund either.
    });
    const { cb, done } = collectingCallbacks();
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "update-premium"))
      .map((s) => s.id);
    const result = await runParcoursAuto(
      DEF,
      {
        values: {
          ...defaultContextValues(),
          person_id: "p-1",
          payment_method_id: "pm-1",
          product_id: "prod-1",
          contract_id: "c-1",
          premium_id: "prem-1",
        },
        done: doneIds,
        autoOptional: ["create-periodic-premium"],
      },
      noAbort,
      cb,
      call,
    );
    // The run finishes rather than abandoning a DRAFT contract, and the step it
    // could not build is left pending instead of being reported as complete.
    expect(result.kind).toBe("reached-documents");
    expect(calls.some((c) => c.operationId === "createPeriodicPremium")).toBe(
      false,
    );
    expect(done.some((d) => d.id === "create-periodic-premium")).toBe(false);
    expect(calls.some((c) => c.operationId === "submitContract")).toBe(true);
  });

  it("runs update-contract even with no contract_id, so the failure surfaces there", async () => {
    const { call, calls } = mockCall({
      ...happyHandlers,
      // 2xx without an id the producer matches: contract_id stays empty.
      createContract: () => res(201, {}),
      updateContract: () => res(404, { detail: "not found" }),
    });
    const { cb } = collectingCallbacks();
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "list-products") + 1)
      .map((s) => s.id);
    const result = await runParcoursAuto(
      DEF,
      {
        values: {
          ...defaultContextValues(),
          person_id: "p-1",
          payment_method_id: "pm-1",
          product_id: "prod-1",
        },
        done: doneIds,
        autoOptional: [],
      },
      noAbort,
      cb,
      call,
    );
    // `autoRun` means unconditional: the missing-prerequisite skip must not
    // swallow it, or the run fails later at submit with a misleading 422.
    expect(calls.some((c) => c.operationId === "updateContract")).toBe(true);
    expect(result).toMatchObject({ kind: "error", stepId: "update-contract" });
  });

  it("skips list-products without pausing when product_id is preset", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb, done } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      {
        values: { ...defaultContextValues(), product_id: "prod-1" },
        done: [],
      },
      noAbort,
      cb,
      call,
    );
    expect(result.kind).toBe("reached-documents");
    expect(calls.some((c) => c.operationId === "listProducts")).toBe(false);
    expect(done.some((d) => d.id === "list-products")).toBe(true);
  });

  it("retries create-individual with a fresh identity on 409", async () => {
    const { call, calls } = mockCall({
      ...happyHandlers,
      createIndividual: (n) => (n < 2 ? res(409, {}) : res(201, { id: "p-1" })),
    });
    const { cb, done } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      { values: defaultContextValues(), done: [] },
      noAbort,
      cb,
      call,
      stubLoader,
    );
    expect(result.kind).toBe("paused-picker");

    const attempts = calls.filter((c) => c.operationId === "createIndividual");
    expect(attempts).toHaveLength(3);
    const identities = attempts.map((c) =>
      JSON.stringify([
        (c.body as Record<string, unknown>).first_name,
        (c.body as Record<string, unknown>).last_name,
        (c.body as Record<string, unknown>).birth,
      ]),
    );
    // Each retry regenerated the identity (collisions are astronomically
    // unlikely across the pools; assert at least the last differs from the first).
    expect(new Set(identities).size).toBeGreaterThan(1);
    // person_name matches the identity that finally succeeded.
    const created = done.find((d) => d.id === "create-individual");
    const last = attempts[2].body as Record<string, unknown>;
    expect(created?.produced.person_name).toBe(
      `${last.first_name} ${last.last_name}`,
    );
    // The bank account holder uses that same final identity.
    const bank = calls.find((c) => c.operationId === "createBankAccount");
    expect((bank?.body as Record<string, unknown>).account_holder_name).toBe(
      created?.produced.person_name,
    );
  });

  it("gives up after 3 consecutive 409s", async () => {
    const { call, calls } = mockCall({
      ...happyHandlers,
      createIndividual: () => res(409, {}),
    });
    const { cb } = collectingCallbacks();
    const result = await runParcoursAuto(DEF, { values: defaultContextValues(), done: [] }, noAbort, cb, call);
    expect(result).toMatchObject({ kind: "error", stepId: "create-individual" });
    expect(calls.filter((c) => c.operationId === "createIndividual")).toHaveLength(3);
  });

  it("stops on a non-2xx and keeps prior progress", async () => {
    const { call } = mockCall({
      ...happyHandlers,
      upsertPersonAddressByType: () => res(422, { detail: "bad address" }),
    });
    const { cb, done } = collectingCallbacks();
    const result = await runParcoursAuto(DEF, { values: defaultContextValues(), done: [] }, noAbort, cb, call);
    expect(result).toMatchObject({ kind: "error", stepId: "person-address" });
    expect(done.map((d) => d.id)).toEqual(["create-individual"]);
  });

  it("errors in French when the product has no funds", async () => {
    const { call } = mockCall({
      ...happyHandlers,
      listProductFunds: () => res(200, { funds: [] }),
    });
    const { cb } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      {
        values: { ...defaultContextValues(), product_id: "prod-1" },
        done: [],
      },
      noAbort,
      cb,
      call,
    );
    expect(result).toMatchObject({
      kind: "error",
      stepId: "create-premium",
      message: "Aucun fonds disponible pour ce produit.",
    });
  });

  it("returns cancelled without any call when pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      { values: defaultContextValues(), done: [] },
      controller.signal,
      cb,
      call,
    );
    expect(result.kind).toBe("cancelled");
    expect(calls).toHaveLength(0);
  });

  it("skips person creation when person_id is preset and reuses it downstream", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb, done } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      { values: { person_id: "p-preset" }, done: [] },
      noAbort,
      cb,
      call,
    );
    expect(result.kind).toBe("paused-picker");
    expect(calls.some((c) => c.operationId === "createIndividual")).toBe(false);
    expect(done.some((d) => d.id === "create-individual")).toBe(true);
    const address = calls.find(
      (c) => c.operationId === "upsertPersonAddressByType",
    );
    expect(address?.pathParams?.person_id).toBe("p-preset");
  });

  it("never crosses the documents step", () => {
    const stopIdx = DEF.steps.findIndex((s) => s.id === AUTO_STOP_STEP_ID);
    expect(stopIdx).toBeGreaterThan(0);
  });

  it("stops at the documents step even when it is already done", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    // Everything up to AND INCLUDING the documents step done by hand.
    const stopIdx = DEF.steps.findIndex((s) => s.id === AUTO_STOP_STEP_ID);
    const doneIds = DEF.steps.slice(0, stopIdx + 1).map((s) => s.id);
    const result = await runParcoursAuto(
      DEF,
      {
        values: {
          ...defaultContextValues(),
          person_id: "p-1",
          payment_method_id: "pm-1",
          product_id: "prod-1",
          contract_id: "c-1",
          premium_id: "prem-1",
        },
        done: doneIds,
      },
      noAbort,
      cb,
      call,
    );
    expect(result.kind).toBe("reached-documents");
    // No Phase D back-office operation ran.
    expect(calls).toHaveLength(0);
  });

  it("re-runs a done picker step when its context output was cleared", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "list-products") + 1)
      .map((s) => s.id);
    // list-products is done but product_id was cleared from the panel:
    // the runner must re-pause at the picker, not POST a contract without
    // product_id.
    const result = await runParcoursAuto(
      DEF,
      {
        values: { person_id: "p-1", payment_method_id: "pm-1" },
        done: doneIds,
      },
      noAbort,
      cb,
      call,
    );
    expect(result).toMatchObject({ kind: "paused-picker", stepId: "list-products" });
    expect(calls.map((c) => c.operationId)).toEqual(["listProducts"]);
  });

  it("captures a step's outputs even when aborted while its request was in flight", async () => {
    const controller = new AbortController();
    const { call, calls } = mockCall({
      ...happyHandlers,
      // Abort arrives while createIndividual is in flight; the request still
      // completes 201 server-side.
      createIndividual: () => {
        controller.abort();
        return res(201, { id: "p-1" });
      },
    });
    const { cb, done } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      { values: defaultContextValues(), done: [] },
      controller.signal,
      cb,
      call,
    );
    expect(result.kind).toBe("cancelled");
    // The created person's id + name were captured before stopping.
    const created = done.find((d) => d.id === "create-individual");
    expect(created?.produced.person_id).toBe("p-1");
    expect(created?.produced.person_name).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("returns an error result (never rejects) when callOperation throws", async () => {
    const throwingCall: CallOperationFn = async () => {
      throw new Error("URL non autorisée");
    };
    const { cb } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      { values: defaultContextValues(), done: [] },
      noAbort,
      cb,
      throwingCall,
    );
    expect(result).toMatchObject({
      kind: "error",
      stepId: "create-individual",
      message: "URL non autorisée",
    });
  });

  it("carries the failed request as a draft on a non-2xx", async () => {
    const { call } = mockCall({
      ...happyHandlers,
      upsertPersonAddressByType: () => res(422, { detail: "bad address" }),
    });
    const { cb } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      { values: defaultContextValues(), done: [] },
      noAbort,
      cb,
      call,
      stubLoader,
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.draft?.params).toMatchObject({ person_id: "p-1" });
      expect(result.draft?.body).toMatchObject({ country_code: "FR" });
    }
  });

  it("references the bank account captured by an earlier pass on resume", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    // Run 1 registered the bank account and captured its id, then stopped before
    // create-payment-method. The resume must reference that account rather than
    // re-register one, and must not resend the bank details.
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "create-payment-method"))
      .map((s) => s.id);
    await runParcoursAuto(
      DEF,
      {
        values: {
          person_id: "p-1",
          person_name: "Test Durand",
          bank_account_id: "ba-run-1",
        },
        done: doneIds,
        drafts: {
          "person-bank-account": {
            params: { person_id: "p-1" },
            body: { iban: "FR0012345678901234567890123", currency: "EUR" },
          },
        },
      },
      noAbort,
      cb,
      call,
    );
    expect(calls.some((c) => c.operationId === "createBankAccount")).toBe(false);
    const pm = calls.find((c) => c.operationId === "createPaymentMethod");
    expect(pm?.body).toMatchObject({ bank_account_id: "ba-run-1" });
    expect(pm?.body).not.toHaveProperty("iban");
  });

  it("carries the run's IBAN into a bank account re-registered after a failure", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    // The bank-account step is NOT done (it failed last pass), so it runs again:
    // `newAutoSeed` recovers the IBAN from its draft so the account registered
    // now is the one the earlier attempt described.
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "person-bank-account"))
      .map((s) => s.id);
    await runParcoursAuto(
      DEF,
      {
        values: { person_id: "p-1", person_name: "Test Durand" },
        done: doneIds,
        drafts: {
          "person-bank-account": {
            params: { person_id: "p-1" },
            body: { iban: "FR0012345678901234567890123", bic: "CMCIFR2A" },
          },
        },
      },
      noAbort,
      cb,
      call,
      stubLoader,
    );
    const bank = calls.find((c) => c.operationId === "createBankAccount");
    expect(bank?.body).toMatchObject({
      iban: "FR0012345678901234567890123",
      bic: "CMCIFR2A",
    });
  });
});

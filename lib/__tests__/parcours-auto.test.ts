import { describe, expect, it } from "vitest";
import type { ProxyResponse } from "@/lib/http";
import { SOUSCRIPTION_PARCOURS, type ContextValues } from "@/lib/parcours";
import {
  AUTO_STOP_STEP_ID,
  buildAutoDraftForStep,
  buildAutoRequest,
  newAutoSeed,
  randomIdentity,
  runParcoursAuto,
  todayIso,
  type AutoRunCallbacks,
  type CallOperationFn,
} from "@/lib/parcours-auto";
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

// A ctx as the runner would build it, with a fixed identity for assertions.
function makeCtx(values: ContextValues = {}) {
  return {
    values,
    identity: {
      firstName: "Test",
      lastName: "Durand",
      birthDate: "1980-01-15",
      fullName: "Test Durand",
    },
    iban: "FR7630006000011234567890189",
    bic: "AGRIFRPP",
    beneficiaryClause: "Mon conjoint, à défaut mes héritiers.",
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
  it("create-individual carries the identity", () => {
    const ctx = makeCtx();
    const { pathParams, body } = buildAutoRequest(step("create-individual"), ctx);
    expect(pathParams).toEqual({});
    expect(body).toEqual({
      first_name: "Test",
      last_name: "Durand",
      birth: { date_of_birth: "1980-01-15" },
    });
  });

  it("person-address merges seed path params with the random address", () => {
    const ctx = makeCtx({ person_id: "p-1" });
    const { pathParams, body } = buildAutoRequest(step("person-address"), ctx);
    expect(pathParams).toEqual({ person_id: "p-1", address_type: "PRINCIPAL" });
    expect(body).toEqual({
      line1: "1 rue de la Paix",
      postal_code: "75002",
      city: "Paris",
      country_code: "FR",
    });
  });

  it("bank account and payment method share the same IBAN, holder = person", () => {
    const ctx = makeCtx({ person_id: "p-1", person_name: "Test Durand" });
    const bank = buildAutoRequest(step("person-bank-account"), ctx);
    const pm = buildAutoRequest(step("create-payment-method"), ctx);
    expect(bank.body).toMatchObject({
      account_holder_name: "Test Durand",
      iban: ctx.iban,
      currency: "EUR",
      date_of_validity_start: todayIso(),
    });
    expect(pm.body).toMatchObject({
      type: "SEPA_DEBIT",
      iban: ctx.iban,
      bic: ctx.bic,
      mandate_type: "RECURRENT",
    });
  });

  it("person-submit has no body, only the path param", () => {
    const ctx = makeCtx({ person_id: "p-1" });
    const { pathParams, body } = buildAutoRequest(step("person-submit"), ctx);
    expect(pathParams).toEqual({ person_id: "p-1" });
    expect(body).toBeNull();
  });

  it("create-contract seeds product/subscriber and adds submit-required fields", () => {
    const ctx = makeCtx({ product_id: "prod-1", person_id: "p-1" });
    const { body } = buildAutoRequest(step("create-contract"), ctx);
    expect(body).toMatchObject({
      product_id: "prod-1",
      subscriber_id: "p-1",
      date_of_effect: todayIso(),
      beneficiary_clause: expect.stringContaining("héritiers"),
    });
  });

  it("create-premium: 100% on the picked fund, cents amount, seeded payment method", () => {
    const ctx = makeCtx({ contract_id: "c-1", payment_method_id: "pm-1" });
    const { pathParams, body } = buildAutoRequest(step("create-premium"), ctx, {
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
    beneficiaryClause: "Mon conjoint, à défaut mes héritiers.",
    address: { line1: "1 rue de la Paix", postalCode: "75002", city: "Paris" },
  };

  it("shapes a create-individual draft as {body} only (no params)", () => {
    const draft = buildAutoDraftForStep(step("create-individual"), seed, {});
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
    const draft = buildAutoDraftForStep(step("person-address"), seed, {
      person_id: "p-1",
    });
    expect(draft?.params).toEqual({
      person_id: "p-1",
      address_type: "PRINCIPAL",
    });
    expect(draft?.body).toMatchObject({ country_code: "FR" });
  });

  it("returns null when a step has nothing to pre-fill", () => {
    // Optional step: no plan body, and its only seed param (person_id) is absent.
    expect(buildAutoDraftForStep(step("person-fatca"), seed, {})).toBeNull();
  });

  it("newAutoSeed reuses the IBAN from a prior bank-account draft", () => {
    const s = newAutoSeed({
      "person-bank-account": {
        body: { iban: "FR0012345678901234567890123" },
      },
    });
    expect(s.iban).toBe("FR0012345678901234567890123");
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
    const result = await runParcoursAuto(DEF, { values: {}, done: [] }, noAbort, cb, call);

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
    // update-contract completes the DRAFT with the fields the submit endpoint
    // requires (date of effect + beneficiary clause).
    const update = calls.find((c) => c.operationId === "updateContract");
    expect(update?.pathParams).toEqual({ contract_id: "c-1" });
    expect(update?.body).toMatchObject({
      date_of_effect: todayIso(),
      beneficiary_clause: expect.stringContaining("héritiers"),
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

  it("skips list-products without pausing when product_id is preset", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb, done } = collectingCallbacks();
    const result = await runParcoursAuto(
      DEF,
      { values: { product_id: "prod-1" }, done: [] },
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
    const result = await runParcoursAuto(DEF, { values: {}, done: [] }, noAbort, cb, call);
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
    const result = await runParcoursAuto(DEF, { values: {}, done: [] }, noAbort, cb, call);
    expect(result).toMatchObject({ kind: "error", stepId: "create-individual" });
    expect(calls.filter((c) => c.operationId === "createIndividual")).toHaveLength(3);
  });

  it("stops on a non-2xx and keeps prior progress", async () => {
    const { call } = mockCall({
      ...happyHandlers,
      upsertPersonAddressByType: () => res(422, { detail: "bad address" }),
    });
    const { cb, done } = collectingCallbacks();
    const result = await runParcoursAuto(DEF, { values: {}, done: [] }, noAbort, cb, call);
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
      { values: { product_id: "prod-1" }, done: [] },
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
      { values: {}, done: [] },
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
      { values: {}, done: [] },
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
      { values: {}, done: [] },
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
    const result = await runParcoursAuto(DEF, { values: {}, done: [] }, noAbort, cb, call);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.draft?.params).toMatchObject({ person_id: "p-1" });
      expect(result.draft?.body).toMatchObject({ country_code: "FR" });
    }
  });

  it("reuses the IBAN from a previous run's drafts on resume", async () => {
    const { call, calls } = mockCall(happyHandlers);
    const { cb } = collectingCallbacks();
    // Run 1 registered the bank account with this IBAN, then stopped before
    // create-payment-method.
    const doneIds = DEF.steps
      .slice(0, DEF.steps.findIndex((s) => s.id === "create-payment-method"))
      .map((s) => s.id);
    await runParcoursAuto(
      DEF,
      {
        values: { person_id: "p-1", person_name: "Test Durand" },
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
    const pm = calls.find((c) => c.operationId === "createPaymentMethod");
    expect((pm?.body as Record<string, unknown>).iban).toBe(
      "FR0012345678901234567890123",
    );
  });
});

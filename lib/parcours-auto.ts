// Mode semi-automatique du parcours — runs the mandatory steps of the
// souscription parcours with random-but-plausible data, from the current
// frontier up to the Phase C documents step (which stays manual, as does
// Phase D). Driven by app/parcours/page.tsx; executes through callOperation
// (lib/operation-fetch.ts) — never through the RequestBuilder UI.
//
// Pauses instead of guessing at the product picker (`list-products`): the user
// chooses, then relaunches (a relaunch always resumes from the frontier since
// done steps are skipped). Person creation retries with a fresh identity on
// 409 — the person API dedups on first_name + last_name + date_of_birth.
//
// Pure module (no React, no Tauri import at top level besides the ones the
// reused libs already do): testable with an injected `call`.

import type { ProxyResponse } from "@/lib/http";
import { callOperation } from "@/lib/operation-fetch";
import {
  buildSeedForStep,
  extractOptions,
  extractProduced,
  isSuccess,
  mergeContextValues,
  type ContextKey,
  type ContextValues,
  type ParcoursDef,
  type ParcoursStep,
  type ParcoursState,
  type StepDraft,
} from "@/lib/parcours";
import {
  adultBirthDate,
  bic,
  frBeneficiaryClause,
  frCityPostal,
  frFirstName,
  frIban,
  frLastName,
  frStreetLine,
  randomAmountCents,
  toLocalIsoDate,
} from "@/lib/fake-fields";

// --- identity ---------------------------------------------------------------

export interface AutoIdentity {
  firstName: string;
  lastName: string;
  birthDate: string; // YYYY-MM-DD
  fullName: string; // "Prénom Nom" — person_name context + account_holder_name
}

export function randomIdentity(): AutoIdentity {
  const firstName = frFirstName();
  const lastName = frLastName();
  return {
    firstName,
    lastName,
    birthDate: adultBirthDate(),
    fullName: `${firstName} ${lastName}`,
  };
}

export function todayIso(): string {
  return toLocalIsoDate(new Date());
}

// --- per-run context ---------------------------------------------------------

// Stable random identity + bank details for one run. The steps that must agree
// — person ↔ bank-account holder, bank account ↔ SEPA mandate IBAN — read the
// same values from here. Persisted in the parcours state so the semi-automatic
// mode keeps pre-fills consistent across steps; regenerated per run in auto mode.
export interface AutoSeed {
  identity: AutoIdentity;
  iban: string;
  bic: string;
  /** Stable per-run beneficiary clause so create-contract and update-contract
   *  send the same designation. */
  beneficiaryClause: string;
  address: { line1: string; postalCode: string; city: string };
}

// The runner's private mutable bag: an AutoSeed plus a LOCAL authoritative copy
// of the parcours context (React state updates are async; the runner must
// consume ids produced by the previous step immediately).
export type AutoRunCtx = AutoSeed & { values: ContextValues };

// Read a string field out of a persisted step draft's body.
function draftBodyField(
  drafts: ParcoursState["drafts"],
  stepId: string,
  field: string,
): string | null {
  const body = drafts?.[stepId]?.body;
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const v = rec?.[field];
  return typeof v === "string" && v ? v : null;
}

// Generate a fresh AutoSeed. The IBAN/BIC are reused from a previous run's
// persisted drafts when present, so resuming between person-bank-account and
// create-payment-method keeps the SEPA mandate on the same account the
// bank-account step registered.
export function newAutoSeed(drafts?: ParcoursState["drafts"]): AutoSeed {
  const { city, postalCode } = frCityPostal();
  return {
    identity: randomIdentity(),
    iban:
      draftBodyField(drafts, "person-bank-account", "iban") ??
      draftBodyField(drafts, "create-payment-method", "iban") ??
      frIban(),
    bic: draftBodyField(drafts, "create-payment-method", "bic") ?? bic(),
    beneficiaryClause:
      draftBodyField(drafts, "create-contract", "beneficiary_clause") ??
      draftBodyField(drafts, "update-contract", "beneficiary_clause") ??
      frBeneficiaryClause(),
    address: { line1: frStreetLine(), postalCode, city },
  };
}

function newRunCtx(
  values: ContextValues,
  drafts?: ParcoursState["drafts"],
): AutoRunCtx {
  return { ...newAutoSeed(drafts), values: { ...values } };
}

// The holder name must match the person: prefer the context's person_name
// (set when the person was created — possibly in an earlier run or by hand),
// falling back to this run's generated identity.
function holderName(ctx: AutoRunCtx): string {
  return ctx.values.person_name || ctx.identity.fullName;
}

// --- declarative per-step plan ------------------------------------------------

interface AutoStepPlan {
  /** Creating step whose output already exists in the context: mark done
   *  without executing (avoids duplicates on a mid-parcours relaunch). */
  skipIfPresent?: ContextKey;
  /** Random fields for the step's JSON body; merged OVER the seed body
   *  (buildSeedForStep supplies product_id / subscriber_id / payment_method_id). */
  body?: (ctx: AutoRunCtx, extras: AutoExtras) => Record<string, unknown>;
}

export interface AutoExtras {
  /** Randomly-picked fund for create-premium (prefetched from the product). */
  fundId?: string;
}

// (Beneficiary clause is a stable per-run random value on AutoSeed —
// create-contract and update-contract read `ctx.beneficiaryClause`.)
// Bodies mirror the synced OpenAPI contracts (see the step descriptions in
// lib/parcours.ts). Steps absent from this table and not optional run with the
// seed alone (person-submit, submit-contract: no body).
export const AUTO_PLAN: Record<string, AutoStepPlan> = {
  "create-individual": {
    skipIfPresent: "person_id",
    body: (ctx) => ({
      first_name: ctx.identity.firstName,
      last_name: ctx.identity.lastName,
      birth: { date_of_birth: ctx.identity.birthDate },
    }),
  },
  "person-address": {
    body: (ctx) => ({
      line1: ctx.address.line1,
      postal_code: ctx.address.postalCode,
      city: ctx.address.city,
      country_code: "FR",
    }),
  },
  "person-fiscal": {
    body: () => ({ fiscal_type: "FRENCH_RESIDENCY" }),
  },
  "person-bank-account": {
    body: (ctx) => ({
      account_holder_name: holderName(ctx),
      iban: ctx.iban,
      currency: "EUR",
      date_of_validity_start: todayIso(),
    }),
  },
  "create-payment-method": {
    skipIfPresent: "payment_method_id",
    body: (ctx) => ({
      type: "SEPA_DEBIT",
      iban: ctx.iban,
      bic: ctx.bic,
      mandate_type: "RECURRENT",
      date_of_validity_start: todayIso(),
    }),
  },
  "list-products": {
    skipIfPresent: "product_id",
    // No body: handled specially by the runner (pause for the user's pick).
  },
  "create-contract": {
    skipIfPresent: "contract_id",
    // Set the submission-required fields at creation too. The backend may only
    // keep them from the update below, but sending them here is harmless and
    // means a fresh contract already carries them if creation does persist.
    body: (ctx) => ({
      date_of_effect: todayIso(),
      beneficiary_clause: ctx.beneficiaryClause,
    }),
  },
  // A freshly created DRAFT contract doesn't reliably carry date_of_effect /
  // beneficiary_clause (creation drops them), so submission fails 422
  // (« Date of effect / Beneficiary clause is required »). This normally-
  // optional step sets them explicitly on the DRAFT — a direct 200 update per
  // the contract API — before the contract is submitted.
  "update-contract": {
    body: (ctx) => ({
      date_of_effect: todayIso(),
      beneficiary_clause: ctx.beneficiaryClause,
    }),
  },
  "create-premium": {
    skipIfPresent: "premium_id",
    body: (_ctx, extras) => ({
      // Required at contract submission (« funds source is required »).
      type_of_fund_source: "OWN_FUNDS",
      amount: {
        value: randomAmountCents(1000, 10000),
        scale: 2,
        currency: "EUR",
      },
      allocations: {
        funds: [
          {
            fund_id: extras.fundId,
            // Rate schema: fixed scale 5; 10000000 = 100.00000%.
            allocation_rate: { value: 10000000, scale: 5 },
          },
        ],
      },
    }),
  },
};

/** Steps the automatic mode never crosses (documents, then back-office). */
export const AUTO_STOP_STEP_ID = "complete-service-requests";

const CREATE_INDIVIDUAL_MAX_ATTEMPTS = 3;

// --- request building ----------------------------------------------------------

// Exported for tests: the exact {pathParams, body} an auto-run sends for a step.
export function buildAutoRequest(
  step: ParcoursStep,
  ctx: AutoRunCtx,
  extras: AutoExtras = {},
): { pathParams: Record<string, string>; body: Record<string, unknown> | null } {
  const seed = buildSeedForStep(step, ctx.values);
  const pathParams = seed?.params ?? {};
  const seedBody = (seed?.body ?? {}) as Record<string, unknown>;
  const planBody = AUTO_PLAN[step.id]?.body?.(ctx, extras);
  const merged = { ...seedBody, ...(planBody ?? {}) };
  return {
    pathParams,
    body: Object.keys(merged).length ? merged : null,
  };
}

// The {params, body} draft the semi-automatic mode pre-fills into a step's
// form: the same request the runner would send (buildAutoRequest), shaped as a
// StepDraft the RequestBuilder restores via `initialDraft`. Returns null when
// the step has nothing to pre-fill (no seed params, no plan body — e.g. an
// optional step the user fills or skips by hand).
export function buildAutoDraftForStep(
  step: ParcoursStep,
  seed: AutoSeed,
  values: ContextValues,
  extras: AutoExtras = {},
): StepDraft | null {
  const req = buildAutoRequest(step, { ...seed, values }, extras);
  // buildAutoRequest never returns null, so toDraft yields a StepDraft — {} for
  // a step with neither params nor body. Return the draft only when it carries
  // something; an empty draft means "nothing to pre-fill" (leave the form empty
  // so the user fills or skips it).
  const draft = toDraft(req);
  if (draft && (draft.params !== undefined || draft.body !== undefined))
    return draft;
  return null;
}

// --- runner ---------------------------------------------------------------------

export type CallOperationFn = typeof callOperation;

export interface AutoRunCallbacks {
  onStepStart: (step: ParcoursStep) => void;
  /** Fired after each completed (or skipped) step so the page can advance its
   *  state; `draft` carries the request actually sent (inspectable/replayable
   *  in the RequestBuilder). */
  onStepDone: (
    step: ParcoursStep,
    produced: ContextValues,
    draft?: StepDraft,
  ) => void;
}

export type AutoRunResult =
  | { kind: "paused-picker"; stepId: string; res: ProxyResponse }
  | { kind: "reached-documents" }
  | {
      kind: "error";
      stepId: string;
      res: ProxyResponse | null;
      message: string;
      /** The request that failed, so the page can persist it as the step's
       *  draft — the RequestBuilder then shows exactly what was sent. */
      draft?: StepDraft;
    }
  | { kind: "cancelled"; stepId: string };

function toDraft(
  sent: {
    pathParams: Record<string, string>;
    body: Record<string, unknown> | null;
  } | null,
): StepDraft | undefined {
  if (!sent) return undefined;
  return {
    ...(Object.keys(sent.pathParams).length ? { params: sent.pathParams } : {}),
    ...(sent.body !== null ? { body: sent.body } : {}),
  };
}

function httpError(
  step: ParcoursStep,
  res: ProxyResponse | null,
  draft?: StepDraft,
): AutoRunResult {
  return {
    kind: "error",
    stepId: step.id,
    res,
    message: res
      ? `HTTP ${res.status} sur « ${step.title} »`
      : `Contrat introuvable pour « ${step.title} » (${step.apiId}/${step.operationId})`,
    ...(draft ? { draft } : {}),
  };
}

// Fetch the product's funds via the step's own fieldOptions declaration and
// pick one at random. Returns null (with no throw) when nothing is usable.
async function pickRandomFund(
  step: ParcoursStep,
  ctx: AutoRunCtx,
  signal: AbortSignal,
  call: CallOperationFn,
): Promise<string | null> {
  const src = step.fieldOptions?.find((f) => f.field === "fund_id");
  if (!src) return null;
  const pathParams: Record<string, string> = {};
  for (const p of src.params) {
    const v = ctx.values[p.from];
    if (!v) return null;
    pathParams[p.name] = v;
  }
  const res = await call({
    apiId: src.apiId,
    operationId: src.operationId,
    pathParams,
    method: "GET",
    signal,
  });
  if (!res || !isSuccess(res)) return null;
  const options = extractOptions(res.body, src.select);
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)].id;
}

// Run the parcours automatically from the frontier until the documents step,
// a picker pause, an error, or a cancel. The page applies each onStepDone via
// advanceState/saveParcoursState; the runner's local ctx.values stays the
// authority within the run (both sides apply the same mergeContextValues).
// Never rejects: exceptions (e.g. checkUrl refusing the resolved URL) come
// back as an error result so the page can't get stuck in "running".
export async function runParcoursAuto(
  def: ParcoursDef,
  snapshot: Pick<ParcoursState, "values" | "done"> & {
    drafts?: ParcoursState["drafts"];
  },
  signal: AbortSignal,
  cb: AutoRunCallbacks,
  call: CallOperationFn = callOperation,
): Promise<AutoRunResult> {
  const ctx = newRunCtx(snapshot.values, snapshot.drafts);
  const done = new Set(snapshot.done);

  const markDone = (step: ParcoursStep, produced: ContextValues, draft?: StepDraft) => {
    ctx.values = mergeContextValues(ctx.values, produced);
    done.add(step.id);
    cb.onStepDone(step, produced, draft);
  };

  let current: ParcoursStep | null = null;
  try {
    for (const step of def.steps) {
      current = step;
      // The hard stop comes before the done-skip: even when the documents step
      // has been completed by hand, the auto mode never crosses into Phase C/D.
      if (step.id === AUTO_STOP_STEP_ID) return { kind: "reached-documents" };

      const plan = AUTO_PLAN[step.id];

      // A done step is skipped — unless its captured output has since been
      // cleared from the context (hand-edited): then it must run again (e.g.
      // list-products re-pauses at the picker to re-choose the product).
      const outputMissing =
        !!plan?.skipIfPresent && !ctx.values[plan.skipIfPresent];
      if (done.has(step.id) && !outputMissing) continue;
      if (signal.aborted) return { kind: "cancelled", stepId: step.id };

      // Output already in context (mid-parcours relaunch, hand-pasted id):
      // completing the step again would create a duplicate — mark done instead.
      if (plan?.skipIfPresent && ctx.values[plan.skipIfPresent]) {
        markDone(step, {});
        continue;
      }

      // Optional steps are skipped like the page's « Passer » button — unless
      // the plan gives them a body (update-contract completes the DRAFT with
      // the fields the submit endpoint requires), in which case they execute.
      if (step.optional && !plan?.body) {
        markDone(step, {});
        continue;
      }

      cb.onStepStart(step);

      // Picker step (product choice): fetch the list, then hand over to the
      // user — the existing picker UI confirms and writes product_id.
      if (step.selects) {
        const res = await call({
          apiId: step.apiId,
          operationId: step.operationId,
          method: "GET",
          signal,
        });
        if (!res || !isSuccess(res)) {
          if (signal.aborted) return { kind: "cancelled", stepId: step.id };
          return httpError(step, res);
        }
        return { kind: "paused-picker", stepId: step.id, res };
      }

      // create-premium needs a fund from the selected product's catalogue.
      const extras: AutoExtras = {};
      if (step.id === "create-premium") {
        const fundId = await pickRandomFund(step, ctx, signal, call);
        if (signal.aborted) return { kind: "cancelled", stepId: step.id };
        if (!fundId) {
          return {
            kind: "error",
            stepId: step.id,
            res: null,
            message: "Aucun fonds disponible pour ce produit.",
          };
        }
        extras.fundId = fundId;
      }

      // Execute — with a regenerate-identity retry on create-individual's 409
      // (duplicate first_name + last_name + date_of_birth).
      const attempts =
        step.id === "create-individual" ? CREATE_INDIVIDUAL_MAX_ATTEMPTS : 1;
      let res: ProxyResponse | null = null;
      let sent: {
        pathParams: Record<string, string>;
        body: Record<string, unknown> | null;
      } | null = null;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) ctx.identity = randomIdentity();
        sent = buildAutoRequest(step, ctx, extras);
        res = await call({
          apiId: step.apiId,
          operationId: step.operationId,
          pathParams: sent.pathParams,
          ...(sent.body !== null ? { body: sent.body } : {}),
          signal,
        });
        if (!res || res.status !== 409 || signal.aborted) break;
      }
      if (!res || !isSuccess(res)) {
        // A stop request aborts the in-flight fetch, which surfaces as a
        // failed response — report the cancel, not an error.
        if (signal.aborted) return { kind: "cancelled", stepId: step.id };
        return httpError(step, res, toDraft(sent));
      }

      // The request succeeded: capture its outputs BEFORE honouring a stop
      // request, so ids created server-side are never dropped (a later re-run
      // would otherwise create duplicates).
      const produced: ContextValues = extractProduced(step, res);
      if (step.id === "create-individual") {
        // The name lives in the request, not the response — record the
        // identity that finally succeeded so the context shows who was created.
        produced.person_name = ctx.identity.fullName;
      }
      markDone(step, produced, toDraft(sent));
      if (signal.aborted) return { kind: "cancelled", stepId: step.id };
    }
  } catch (e) {
    return {
      kind: "error",
      stepId: current?.id ?? def.steps[0]?.id ?? "",
      res: null,
      message: e instanceof Error ? e.message : String(e),
    };
  }

  // Ran off the end without meeting the documents step (defensive: the
  // souscription parcours always has one).
  return { kind: "reached-documents" };
}

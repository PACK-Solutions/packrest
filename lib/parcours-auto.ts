// Mode semi-automatique du parcours — runs the mandatory steps of the
// souscription parcours with random-but-plausible data (plus the optional steps
// the user ticked in the mode panel — see `optionalAutoSteps`), from the current
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
  frCityPostal,
  frFirstName,
  frIban,
  frLastName,
  frStreetLine,
  tinNumber,
  toLocalIsoDate,
} from "@/lib/fake-fields";
import { deepMerge } from "@/lib/json-path";
import {
  sampleFromSchema,
  validateAgainstSchema,
  type SchemaIssue,
} from "@/lib/schema-sample";
import { money, parcoursHints } from "@/lib/parcours-hints";
import { findEndpoint, loadSpec } from "@/lib/specs";
import type { JsonSchema } from "@/lib/types";

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
  return isoInDays(0);
}

/** A date `days` from today, in the `date` format the APIs expect. */
export function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalIsoDate(d);
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
  // (No beneficiary clause here: date_of_effect + beneficiary_clause are seeded
  //  declaratively on both contract steps — DEFAULT_BENEFICIARY_CLAUSE in
  //  lib/parcours.ts — so every mode sends the same values.)
  address: { line1: string; postalCode: string; city: string };
}

// The runner's private mutable bag: an AutoSeed plus a LOCAL authoritative copy
// of the parcours context (React state updates are async; the runner must
// consume ids produced by the previous step immediately).
// Plus the fund picked for this run's premiums (prefetched once, on the first
// step that needs one — see `stepNeedsFund`).
export type AutoRunCtx = AutoSeed & {
  values: ContextValues;
  fundId?: string;
};

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

// Generate a fresh AutoSeed. The IBAN/BIC and the address are reused from the
// « Compte bancaire » draft of a previous run when present, so a resumed run
// keeps writing the same person: the bank details stay the ones already
// registered (the payment method only references that account by id), and an
// address step that runs after the resume — the optional CORRESPONDENCE /
// FISCAL ones, or one that failed — repeats the street the PRINCIPAL address
// carries instead of inventing another.
export function newAutoSeed(drafts?: ParcoursState["drafts"]): AutoSeed {
  const fresh = frCityPostal();
  const drafted = {
    line1: draftBodyField(drafts, "person-address", "line1"),
    postalCode: draftBodyField(drafts, "person-address", "postal_code"),
    city: draftBodyField(drafts, "person-address", "city"),
  };
  return {
    identity: randomIdentity(),
    iban: draftBodyField(drafts, "person-bank-account", "iban") ?? frIban(),
    bic: draftBodyField(drafts, "person-bank-account", "bic") ?? bic(),
    // All three or none: a postal code from one town with another's name would
    // be less plausible than a freshly generated pair.
    address:
      drafted.line1 && drafted.postalCode && drafted.city
        ? {
            line1: drafted.line1,
            postalCode: drafted.postalCode,
            city: drafted.city,
          }
        : { line1: frStreetLine(), postalCode: fresh.postalCode, city: fresh.city },
  };
}

function newRunCtx(
  values: ContextValues,
  drafts?: ParcoursState["drafts"],
): AutoRunCtx {
  return { ...newAutoSeed(drafts), values: { ...values } };
}

// (`holderName` moved to lib/parcours-hints.ts, which now owns every value the
//  generated bodies draw on — including the bank account's holder name.)

// --- declarative per-step plan ------------------------------------------------

interface AutoStepPlan {
  /** Creating step whose output already exists in the context: mark done
   *  without executing (avoids duplicates on a mid-parcours relaunch). */
  skipIfPresent?: ContextKey;
  /** Path params the step's `seedFrom` cannot supply, merged OVER the seed ones
   *  — the CRS record is keyed by a `country_code` no earlier step captures. */
  params?: (ctx: AutoRunCtx) => Record<string, string>;
  /** BUSINESS-RULE overrides for the step's JSON body, merged over the
   *  schema-derived body and the seed. Only what the contract cannot express
   *  belongs here (which enum member this parcours files, rates that must total
   *  100%); everything structural comes from the schema. */
  body?: (ctx: AutoRunCtx, extras: AutoExtras) => Record<string, unknown>;
  /** Paths the step must NOT send even though the contract allows them — a
   *  field whose server-side default is deliberately preferred. */
  omit?: string[];
}

export interface AutoExtras {
  /** Randomly-picked fund for the premium steps (prefetched from the product). */
  fundId?: string;
  /** The operation's `application/json` request schema, dereferenced. Supplied by
   *  the caller (`loadStepBodySchema`) rather than fetched here so
   *  `buildAutoRequest` stays synchronous and unit-testable. Absent → no
   *  schema-derived body, and the step falls back to seed + overrides alone. */
  bodySchema?: JsonSchema;
}

/** The country of fiscal residency the automatic CRS declaration is filed for
 *  (a plausible non-French residency — the point of a CRS record). */
export const AUTO_CRS_COUNTRY = "BE";

// A FATCA/CRS `tax_identification_number`, NUMBER variant of the oneOf.
function tin(prefix = ""): Record<string, unknown> {
  return { tin_type: "NUMBER", number: `${prefix}${tinNumber()}` };
}

// One fund carrying the whole premium: rate scale is fixed at 5, so 10000000 =
// 100.00000%. Shared by the initial and the periodic premium.
function fullAllocation(fundId?: string): Record<string, unknown> {
  return {
    funds: [{ fund_id: fundId, allocation_rate: { value: 10000000, scale: 5 } }],
  };
}

// What the CONTRACT cannot tell us.
//
// A step's body is built by walking its dereferenced request schema
// (lib/schema-sample) and filling the leaves from the hint registry
// (lib/parcours-hints) — so field names, nesting, required-ness, enums and
// formats all come from the synced spec and follow it when it changes. This
// table only carries the rest:
//
//   • which member of an enum this parcours files (FRENCH_RESIDENCY vs FATCA vs
//     CRS, RECURRENT, MONTHLY, OWN_FUNDS) — a schema lists the options, it
//     cannot say which one the flow means;
//   • cross-field rules (allocation rates that must total 100%);
//   • fields deliberately left to the server's default (`omit`);
//   • an optional field a step nonetheless chooses to send (the premium updates);
//   • a path param no earlier step captures (the CRS country).
//
// Steps absent from the table run on the generated body plus their `seedFrom`
// alone: the three address steps, « Créer la personne », « Compte bancaire »,
// and both contract steps (whose date_of_effect and beneficiary clause are
// seeded from the context — see CONTRACT_SUBMISSION_SEEDS).
export const AUTO_PLAN: Record<string, AutoStepPlan> = {
  "create-individual": { skipIfPresent: "person_id" },
  // The three address steps need nothing: AddressCreate requires line1 /
  // postal_code / city / country_code, all supplied by the hints from the run's
  // single address, and `address_type` comes from each step's `seedFrom` const.
  // (Reusing one address across the principal / correspondence / fiscal variants
  // is deliberate: a coherent person beats three unrelated streets.)
  "person-fiscal": {
    // `fiscal_type` is a readOnly const discriminator, so the generator omits it;
    // this record carries no other data, and the API has always been given the
    // discriminator explicitly.
    body: () => ({ fiscal_type: "FRENCH_RESIDENCY" }),
  },
  // Optional fiscal declarations, filed only when the auto run opts into them:
  // a US tax link (FATCA) and a non-French residency (CRS, one record per
  // country — the auto run files the single AUTO_CRS_COUNTRY one).
  "person-fatca": {
    body: () => ({
      fiscal_type: "FATCA",
      // Optional in the contract; declaring an indicium is the point of a FATCA
      // record, so this parcours sends one.
      is_pre_existing_contract: false,
      us_indicia: ["US_CITIZENSHIP_OR_GREEN_CARD"],
    }),
  },
  "person-crs": {
    // The record is keyed by a country_code path param no step captures.
    params: () => ({ country_code: AUTO_CRS_COUNTRY }),
    body: () => ({
      fiscal_type: "CRS",
      // Prefixed so a CRS TIN is distinguishable from the FATCA one in a run.
      tax_identification_number: tin("CRS-"),
      // Both optional in the contract: a self-certified record is what makes the
      // declaration meaningful.
      is_self_certification_present: true,
      date_of_self_certification: todayIso(),
    }),
  },
  "create-payment-method": {
    skipIfPresent: "payment_method_id",
    // `type` is a const the generator emits, `bank_account_id` comes from the
    // step's `seedFrom`, `date_of_validity_start` from the date format. Only the
    // mandate flavour is a choice.
    body: () => ({ mandate_type: "RECURRENT" }),
  },
  "list-products": {
    skipIfPresent: "product_id",
    // No body: handled specially by the runner (pause for the user's pick).
  },
  "create-contract": { skipIfPresent: "contract_id" },
  // (« Mettre à jour le contrat » needs no entry: its whole body comes from
  // `seedFrom`. A freshly created DRAFT contract doesn't reliably carry
  // date_of_effect / beneficiary_clause — creation drops them — so submission
  // fails 422; that normally-optional step sets them explicitly on the DRAFT,
  // hence its `autoRun`, which makes the runner execute it unconditionally.)
  "create-premium": {
    skipIfPresent: "premium_id",
    body: (_ctx, extras) => ({
      // Required at contract submission (« funds source is required »).
      type_of_fund_source: "OWN_FUNDS",
      allocations: fullAllocation(extras.fundId),
    }),
  },
  // The two edit steps of Phase B: partial updates the API accepts only while
  // the contract is still DRAFT. Both sit before « Soumettre le contrat », so an
  // auto run that opts into them edits before submitting (a 409 afterwards).
  // Their schemas make everything optional, so the generated body is empty and
  // what to change is entirely this table's call.
  "update-premium": {
    // A new amount only: the allocations (which must keep summing to 100%) stay
    // exactly as created.
    body: () => ({ amount: money(1000, 10000) }),
  },
  "create-periodic-premium": {
    skipIfPresent: "periodic_premium_id",
    // `date_of_start` is deliberately absent: the contract API then defaults it,
    // at acceptance, to max(date_of_effect, date_of_acceptance) + 30 days — i.e.
    // just outside the renunciation window. Any date computed here would instead
    // be validated against that window whenever the back-office decision lands,
    // so a decision taken later than the margin we guessed would fail the
    // acceptance and leave the parcours unfinishable.
    omit: ["dates.date_of_start"],
    body: (_ctx, extras) => ({
      type_of_fund_source: "OWN_FUNDS",
      dates: { date_of_end: isoInDays(365 * 5) },
      periodicity: "MONTHLY",
      allocations: fullAllocation(extras.fundId),
    }),
  },
  "update-periodic-premium": {
    // Amount + periodicity only: re-sending `dates` would re-run the
    // renunciation-window validation for no benefit.
    body: () => ({ periodic_amount: money(50, 500), periodicity: "QUARTERLY" }),
  },
};

/** Steps the automatic mode never crosses (documents, then back-office). */
export const AUTO_STOP_STEP_ID = "complete-service-requests";

const CREATE_INDIVIDUAL_MAX_ATTEMPTS = 3;

/** The optional steps the automatic mode can be asked to execute: the `optional`
 *  steps it could reach — so before the documents step it never crosses — minus
 *  those that always run anyway (`autoRun`). Drives the checkbox list of the mode
 *  panel and the runner's opt-in set. */
export function optionalAutoSteps(def: ParcoursDef): ParcoursStep[] {
  const stop = def.steps.findIndex((s) => s.id === AUTO_STOP_STEP_ID);
  return def.steps
    .slice(0, stop >= 0 ? stop : undefined)
    .filter((s) => s.optional && !s.autoRun);
}

/** True when a step's body needs a fund from the product's catalogue, i.e. it
 *  declares a `fund_id` option source (both premium steps). The runner prefetches
 *  one; the semi-automatic pre-fill waits for the same list. */
export function stepNeedsFund(step: ParcoursStep): boolean {
  return !!step.fieldOptions?.some((f) => f.field === "fund_id");
}

/** Context keys a step needs as PATH params but that the context doesn't hold —
 *  e.g. « Modifier le versement périodique » without a periodic_premium_id,
 *  because its creation step wasn't part of the run. Sending the request anyway
 *  would put an empty segment in the URL, so the runner skips such a step. */
export function missingSeedParams(
  step: ParcoursStep,
  values: ContextValues,
): ContextKey[] {
  const missing: ContextKey[] = [];
  for (const m of step.seedFrom ?? []) {
    if (m.target !== "param" || !("from" in m)) continue;
    if (!values[m.from]?.trim()) missing.push(m.from);
  }
  return missing;
}

// --- request building ----------------------------------------------------------

/** The request schema a step's body must fit: the operation's
 *  `application/json` request body, already dereferenced by `loadSpec`. Returns
 *  undefined for a body-less operation (or an unsynced API), which callers pass
 *  straight through — `buildAutoRequest` then falls back to seed + overrides.
 *
 *  Async, hence separate from `buildAutoRequest`: keeping the request builder
 *  synchronous is what lets it stay a pure, unit-testable function. `loadSpec`
 *  caches per API, so this is one map lookup after the first call. */
export async function loadStepBodySchema(
  step: ParcoursStep,
): Promise<JsonSchema | undefined> {
  const doc = await loadSpec(step.apiId);
  if (!doc) return undefined;
  const entry = findEndpoint(doc, step.apiId, step.operationId);
  return entry?.operation.requestBody?.content?.["application/json"]?.schema;
}

// Exported for tests: the exact {pathParams, body} an auto-run sends for a step.
//
// Three layers, lowest precedence first:
//   1. the CONTRACT — every required leaf of `extras.bodySchema`, valued from the
//      hint registry. This is what makes a spec change land automatically.
//   2. the SEED — ids and user-settled values from the parcours context, by path
//      (`beneficiary_clause.content`), so a real id always beats a generated one.
//   3. the OVERRIDES — AUTO_PLAN's business rules, which must win outright.
//
// Merging is deep for objects and wholesale for arrays (see `deepMerge`): a
// generated `allocations` skeleton is refined by the override's fund list rather
// than blended with it.
export function buildAutoRequest(
  step: ParcoursStep,
  ctx: AutoRunCtx,
  extras: AutoExtras = {},
): { pathParams: Record<string, string>; body: Record<string, unknown> | null } {
  const plan = AUTO_PLAN[step.id];
  const seed = buildSeedForStep(step, ctx.values, extras.bodySchema);
  const pathParams = { ...(seed?.params ?? {}), ...(plan?.params?.(ctx) ?? {}) };
  const generated = sampleFromSchema(extras.bodySchema, {
    hints: parcoursHints(ctx, extras),
    ...(plan?.omit ? { omit: plan.omit } : {}),
  });
  const merged = deepMerge(
    generated,
    seed?.body,
    plan?.body?.(ctx, extras),
  ) as Record<string, unknown> | undefined;
  return {
    pathParams,
    body: merged && Object.keys(merged).length ? merged : null,
  };
}

/** Where the built body disagrees with the contract. Non-fatal: the runner logs
 *  it and sends anyway, so a spec change shows up as a readable warning instead
 *  of an opaque 422. This is the check that would have caught `beneficiary_clause`
 *  becoming an object. */
export function autoRequestIssues(
  body: Record<string, unknown> | null,
  bodySchema: JsonSchema | undefined,
): SchemaIssue[] {
  if (!bodySchema) return [];
  return validateAgainstSchema(body ?? {}, bodySchema);
}

// The {params, body} draft the semi-automatic mode pre-fills into a step's
// form: the same request the runner would send (buildAutoRequest), shaped as a
// StepDraft the RequestBuilder restores via `initialDraft`. Returns null when
// the step has nothing to pre-fill (no seed params, no generated body and no
// overrides — e.g. an optional step the user fills or skips by hand). Pass the
// step's request schema in `extras.bodySchema` to get the contract-derived
// fields; without it only the seed and the overrides are pre-filled.
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
/** Injected like `call` so the runner can be unit-tested without a spec store
 *  (`loadSpec` reads $APPDATA through tauri-plugin-fs). */
export type LoadBodySchemaFn = (
  step: ParcoursStep,
) => Promise<JsonSchema | undefined>;

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
  /** The built body doesn't fit the synced contract. Reported before the call is
   *  made and never fatal — the point is to name the drift (a renamed field, a
   *  scalar that became an object) instead of leaving a bare 422. */
  onDrift?: (step: ParcoursStep, issues: SchemaIssue[]) => void;
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
    autoOptional?: ParcoursState["autoOptional"];
  },
  signal: AbortSignal,
  cb: AutoRunCallbacks,
  call: CallOperationFn = callOperation,
  loadBodySchema: LoadBodySchemaFn = loadStepBodySchema,
): Promise<AutoRunResult> {
  const ctx = newRunCtx(snapshot.values, snapshot.drafts);
  const done = new Set(snapshot.done);
  // Optional steps the user ticked in the mode panel; everything else optional
  // is marked done without a call.
  const optIn = new Set(snapshot.autoOptional ?? []);

  const markDone = (step: ParcoursStep, produced: ContextValues, draft?: StepDraft) => {
    ctx.values = mergeContextValues(ctx.values, produced);
    done.add(step.id);
    cb.onStepDone(step, produced, draft);
  };

  let current: ParcoursStep | null = null;
  // First failure of a step the user only ticked: reported after the run has done
  // everything else, so an optional step can never cost the parcours its ending.
  let optionalFailure: AutoRunResult | null = null;
  try {
    for (const step of def.steps) {
      current = step;
      // The hard stop comes before the done-skip: even when the documents step
      // has been completed by hand, the auto mode never crosses into Phase C/D.
      if (step.id === AUTO_STOP_STEP_ID)
        return optionalFailure ?? { kind: "reached-documents" };

      const plan = AUTO_PLAN[step.id];

      // "Optional, and only run when the user asks for it" — the one predicate
      // every optional-step rule below shares.
      const optionalByChoice = !!step.optional && !step.autoRun;

      // A done step is skipped — unless its captured output has since been
      // cleared from the context (hand-edited): then it must run again (e.g.
      // list-products re-pauses at the picker to re-choose the product). Ticking
      // an optional step in the panel un-completes it (see the page's
      // `toggleAutoOptional`), which is what makes a relaunch reach it — the
      // runner never replays a done step on its own, so a run that pauses at the
      // picker cannot POST the same optional step twice.
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

      // Optional steps are skipped like the page's « Passer » button — unless the
      // user ticked them in the mode panel (`autoOptional`), or the step declares
      // `autoRun` (update-contract, which completes the DRAFT with the fields the
      // submit endpoint requires). Both are explicit: a body added to AUTO_PLAN
      // never enrols an optional step in every run by accident.
      if (optionalByChoice && !optIn.has(step.id)) {
        markDone(step, {});
        continue;
      }

      // A ticked step whose prerequisite was never created (« Modifier le versement
      // périodique » without its creation step) has no id for its path: requesting
      // an empty segment would be worse than not trying. Left NOT done, so the
      // stepper still shows it pending — the user asked for it, and reporting it as
      // complete when nothing was sent would be a lie. `autoRun` is excluded: «
      // Mettre à jour le contrat » must always run, so a missing contract_id has
      // to surface as its own failure instead of being silently dropped.
      if (optionalByChoice && missingSeedParams(step, ctx.values).length) continue;

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

      // Both premium steps allocate onto a fund of the selected product's
      // catalogue, fetched through the step's own `fieldOptions`.
      const extras: AutoExtras = {};
      if (stepNeedsFund(step)) {
        // Fetched once per run: both premiums then allocate onto the same fund,
        // and the catalogue (the slowest GET of Phase B) is not re-read.
        ctx.fundId ??= (await pickRandomFund(step, ctx, signal, call)) ?? undefined;
        if (signal.aborted) return { kind: "cancelled", stepId: step.id };
        if (!ctx.fundId) {
          // No fund to allocate onto. Mandatory (« Versement initial ») is fatal:
          // the contract can't be submitted without it. A ticked optional step is
          // left pending instead, so a product with no fund list doesn't abandon
          // the run on a half-built contract.
          if (optionalByChoice) continue;
          return {
            kind: "error",
            stepId: step.id,
            res: null,
            message: "Aucun fonds disponible pour ce produit.",
          };
        }
        extras.fundId = ctx.fundId;
      }

      // The contract this step's body is built from. A missing schema is not an
      // error (body-less operations have none); the request then falls back to
      // the seed and the step's overrides, as it did before bodies were derived.
      extras.bodySchema = await loadBodySchema(step);
      if (signal.aborted) return { kind: "cancelled", stepId: step.id };

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
        if (cb.onDrift && attempt === 0) {
          const issues = autoRequestIssues(sent.body, extras.bodySchema);
          if (issues.length) cb.onDrift(step, issues);
        }
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
        const failure = httpError(step, res, toDraft(sent));
        // A step the user merely ticked must not cost the rest of the parcours:
        // remember the first such failure, carry on, and report it once the run
        // has reached the documents step. The step stays NOT done, so the stepper
        // shows it pending and the error card points at it.
        if (optionalByChoice) {
          optionalFailure ??= failure;
          continue;
        }
        return failure;
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
  return optionalFailure ?? { kind: "reached-documents" };
}

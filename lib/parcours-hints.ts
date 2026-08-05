// Domain values for the parcours' schema-driven bodies.
//
// lib/schema-sample.ts derives a body's SHAPE from the contract; this table
// supplies the values a schema cannot invent — a plausible French identity, a
// checksum-valid IBAN, the run's address, the ids already captured in the
// parcours context. Together they replace the thirteen hand-typed body literals
// AUTO_PLAN used to carry, which is what let the contract drift away unnoticed
// when `beneficiary_clause` became an object.
//
// One hint per concept, matched by property name (any depth) or by full path
// when the name alone is ambiguous — `tax_identification_number.number` is a
// TIN, a bare `number` is not.

import {
  CONTEXT_FIELDS,
  DEFAULT_BENEFICIARY_CLAUSE,
  defaultClauseDateOfEffect,
  type ContextValues,
} from "@/lib/parcours";
import { randomAmountCents, tinNumber } from "@/lib/fake-fields";
import { SAMPLE_SKIP, type SampleHint } from "@/lib/schema-sample";
import type { AutoExtras, AutoRunCtx } from "@/lib/parcours-auto";

/** An `Amount`: value in minor units with its scale, as every monetary field of
 *  these contracts expects. Exported because the two premium UPDATE steps choose
 *  to send an amount even though their partial-update schemas make it optional —
 *  a step's editorial choice, so it lives in AUTO_PLAN and reuses this builder
 *  rather than re-deriving the shape. */
export function money(minEuros: number, maxEuros: number): Record<string, unknown> {
  return { value: randomAmountCents(minEuros, maxEuros), scale: 2, currency: "EUR" };
}

/** The holder name must match the person: prefer the context's `person_name`
 *  (set when the person was created — possibly in an earlier run or by hand),
 *  falling back to this run's generated identity. */
function holderName(ctx: AutoRunCtx): string {
  return ctx.values.person_name || ctx.identity.fullName;
}

/** Every id already in the parcours context becomes a hint on its own name, so
 *  a body property named after a context key resolves without a per-step seed
 *  mapping.
 *
 *  A key the context cannot supply yet SKIPS the property rather than letting the
 *  generator invent one: a placeholder (or a random uuid) would point at no
 *  resource and turn "field required" into an obscure server error. */
function contextIdHints(values: ContextValues): SampleHint[] {
  return CONTEXT_FIELDS.map((f) => ({
    name: f.key,
    value: () => values[f.key] || SAMPLE_SKIP,
  }));
}

export function parcoursHints(
  ctx: AutoRunCtx,
  extras: AutoExtras = {},
): SampleHint[] {
  return [
    // --- identity ---------------------------------------------------------
    { name: "first_name", value: () => ctx.identity.firstName },
    { name: "last_name", value: () => ctx.identity.lastName },
    { name: "date_of_birth", value: () => ctx.identity.birthDate },

    // --- address ----------------------------------------------------------
    { name: "line1", value: () => ctx.address.line1 },
    { name: "postal_code", value: () => ctx.address.postalCode },
    { name: "city", value: () => ctx.address.city },
    { name: "country_code", value: () => "FR" },

    // --- bank details -----------------------------------------------------
    // The IBAN/BIC live on the bank account; the SEPA payment method carries
    // neither and only references that account by id.
    { name: "iban", value: () => ctx.iban },
    { name: "bic", value: () => ctx.bic },
    { name: "account_holder_name", value: () => holderName(ctx) },
    { name: "currency", value: () => "EUR" },

    // --- fiscal -----------------------------------------------------------
    // A FATCA/CRS TIN, NUMBER variant of the oneOf: which variant this parcours
    // files is a choice, not something the schema implies. Path-keyed because a
    // bare `number` property elsewhere is not a TIN.
    {
      name: "tax_identification_number",
      value: () => ({ tin_type: "NUMBER", number: tinNumber() }),
    },

    // --- money ------------------------------------------------------------
    { name: "amount", value: () => money(1000, 10000) },
    { name: "periodic_amount", value: () => money(50, 500) },

    // --- contract ---------------------------------------------------------
    // Both contract steps also SEED these from the context (so a value the user
    // edits survives), and the seed wins. They are declared here too so the
    // rule is expressed where bodies are generated: the clause's own
    // date_of_effect must be strictly later than the request date — distinct
    // from the contract's own date_of_effect, which is today and needs no hint.
    {
      path: "beneficiary_clause.content",
      value: () => ctx.values.beneficiary_clause_content || DEFAULT_BENEFICIARY_CLAUSE,
    },
    {
      path: "beneficiary_clause.date_of_effect",
      value: () =>
        ctx.values.beneficiary_clause_date_of_effect || defaultClauseDateOfEffect(),
    },

    // --- product catalogue -------------------------------------------------
    // Prefetched from the chosen product by the runner / the semi-auto pre-fill.
    // No fund yet → leave the leaf out; a made-up ISIN allocates onto nothing.
    { name: "fund_id", value: () => extras.fundId ?? ctx.fundId ?? SAMPLE_SKIP },

    // Context ids last: a specific hint above wins over the generic lookup.
    ...contextIdHints(ctx.values),
  ];
}

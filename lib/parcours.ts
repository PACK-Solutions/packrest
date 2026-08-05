// Parcours de souscription — the declarative backbone + state plumbing for the
// guided cross-API wizard (app/parcours/page.tsx). A "parcours" is an ordered,
// phase-grouped list of API operations that together realise a full business
// flow (here: souscription d'un contrat). Each step pre-fills its request from
// values captured by earlier steps, and captures its own outputs (ids, service
// request ids, contract number) back into a shared context so the next step is
// pre-seeded.
//
// This module owns:
//   • the step definitions (SOUSCRIPTION_PARCOURS),
//   • the sessionStorage-backed parcours state (values + progress),
//   • buildSeedForStep()   → an ImportSeed the RequestBuilder consumes,
//   • extractProduced()    → pulls a step's outputs out of its response.
//
// It touches no Tauri/plugin API and no React — pure data + helpers — so it is
// safe to import anywhere (page, components, tests).

import type { ImportSeed } from "@/lib/bruno";
import type { ProxyResponse } from "@/lib/http";
import type { JsonSchema } from "@/lib/types";
// Pure modules (no React/Tauri) — safe to import here.
import { toLocalIsoDate } from "@/lib/fake-fields";
import {
  formatPath,
  getAtPath,
  isLeafValue,
  setAtPath,
  type PathSeg,
} from "@/lib/json-path";
import { coerceToSchema, schemaAtPath } from "@/lib/schema-sample";
// Type-only (erased at build) — no runtime cycle with lib/parcours-auto, which
// imports this module at runtime.
import type { AutoSeed } from "@/lib/parcours-auto";

// The values that flow between steps. Some are user-picked while browsing the
// catalogue (product_id); the rest are captured from POST/submit
// responses. All are stored (and edited) as strings.
export type ContextKey =
  | "product_id"
  | "person_id"
  | "person_name"
  | "payment_method_id"
  // The bank account backing the SEPA payment method: the IBAN/BIC live there,
  // and the payment method only references it (payment-method API).
  | "bank_account_id"
  | "rum"
  | "contract_id"
  | "contract_number"
  | "sr_contract_id"
  | "sr_mandate_id"
  | "premium_id"
  | "periodic_premium_id"
  | "sr_beneficiary_id"
  // Contract fields required at submission. They live in the context (not as a
  // per-step constant) so the value the user settles on is the one BOTH contract
  // steps send: « Mettre à jour le contrat » must not overwrite a clause typed at
  // creation with a default. Seeded with a default by `initialState`, captured
  // back from each contract response, editable in the context panel.
  | "date_of_effect"
  // The beneficiary clause is an OBJECT in the contract
  // (`{content, date_of_effect}`), so it takes two context keys: a context value
  // is always a flat string, and the seed mappings address the two leaves by
  // path (see CONTRACT_SUBMISSION_SEEDS). The clause's own date_of_effect is
  // distinct from the contract's and must be strictly in the future.
  | "beneficiary_clause_content"
  | "beneficiary_clause_date_of_effect";

export interface ContextField {
  key: ContextKey;
  label: string;
  /** True when the value is normally typed/pasted by the user (catalogue pick)
   *  rather than captured automatically from a response. */
  manual?: boolean;
}

// Order + labels for the context panel. `manual` fields render as editable
// inputs from the start; the others fill in as steps run (still editable, so a
// value can be corrected or pasted by hand).
export const CONTEXT_FIELDS: ContextField[] = [
  { key: "product_id", label: "product_id", manual: true },
  { key: "person_id", label: "person_id" },
  { key: "person_name", label: "person_name (souscripteur)" },
  { key: "payment_method_id", label: "payment_method_id" },
  { key: "bank_account_id", label: "bank_account_id" },
  { key: "rum", label: "rum" },
  { key: "contract_id", label: "contract_id" },
  { key: "contract_number", label: "contract_number" },
  { key: "premium_id", label: "premium_id (versement initial)" },
  { key: "periodic_premium_id", label: "periodic_premium_id" },
  { key: "sr_contract_id", label: "SR contrat (id)" },
  { key: "sr_mandate_id", label: "SR mandat SEPA (id)" },
  { key: "sr_beneficiary_id", label: "SR clause bénéficiaire (id)" },
  { key: "date_of_effect", label: "date_of_effect (contrat)", manual: true },
  {
    key: "beneficiary_clause_content",
    label: "beneficiary_clause.content (clause bénéficiaire)",
    manual: true,
  },
  {
    key: "beneficiary_clause_date_of_effect",
    label: "beneficiary_clause.date_of_effect (postérieure à ce jour)",
    manual: true,
  },
];

export type ContextValues = Partial<Record<ContextKey, string>>;

// --- step definition -------------------------------------------------------

// One entry of `seedFrom`: put a value into the request before the user sees
// it. The value comes either from the parcours context (`from`) or is a fixed
// literal (`const`, e.g. address_type = PRINCIPAL, status = UNDER_REVIEW).
//
// `name` is a PATH (lib/json-path), not just a top-level field name, so a
// nested contract property can be seeded: `beneficiary_clause.content` reaches
// the leaf of an object, `allocations.funds[0].fund_id` a leaf inside a list.
// Flat names keep working — a path without separators is one segment.
export type SeedMapping =
  | ({ target: "param" | "body"; name: string } & (
      | { from: ContextKey }
      | { const: string }
    ));

// Default beneficiary designation — the clause's `content`. The clause and
// `date_of_effect` are both required at submission (POST /contracts/{id}/submit
// has no body), so the context starts with usable values (see `initialState`)
// and both contract steps seed them FROM the context — never from a constant, so
// a value the user edits (in the form, then captured back, or directly in the
// context panel) survives « Mettre à jour le contrat » instead of being
// overwritten.
export const DEFAULT_BENEFICIARY_CLAUSE = "Mes héritiers légaux, à parts égales";

/** Today, as the `date` the contract API expects (local, not UTC). */
export function defaultDateOfEffect(): string {
  return toLocalIsoDate(new Date());
}

/** Tomorrow — the clause's own `date_of_effect` must be STRICTLY later than the
 *  date of the request, or the contract API answers `422 OUT_OF_RANGE` on
 *  `/beneficiary_clause/date_of_effect`. Distinct from the contract's own
 *  `date_of_effect`, which is today. */
export function defaultClauseDateOfEffect(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toLocalIsoDate(d);
}

/** True while `iso` is strictly later than today — the clause rule above. Used
 *  to refresh a persisted clause date that a long session has left behind. */
export function isFutureDate(iso: string | undefined): boolean {
  return !!iso && iso > defaultDateOfEffect();
}

// The submission-required contract fields, seeded identically on « Créer le
// contrat » and « Mettre à jour le contrat » (a DRAFT that lost them is
// completed by re-running the update step). The clause is submitted as a WHOLE
// — the contract requires both `content` and `date_of_effect` whenever the key
// is present — which is why it is two path mappings rather than one field.
const CONTRACT_SUBMISSION_SEEDS: SeedMapping[] = [
  { target: "body", name: "date_of_effect", from: "date_of_effect" },
  {
    target: "body",
    name: "beneficiary_clause.content",
    from: "beneficiary_clause_content",
  },
  {
    target: "body",
    name: "beneficiary_clause.date_of_effect",
    from: "beneficiary_clause_date_of_effect",
  },
];

// Captured back from a contract response so the value the contract actually
// carries (which may be the one the user typed over the default) becomes the
// context value the next contract step re-sends.
//
// The clause is written through the singular `beneficiary_clause` but READ from
// the `beneficiary_clauses` history, ordered by date_of_effect ascending — the
// clause in force is therefore its last entry, hence `[-1]`. Only the content is
// captured: an applied clause's date_of_effect is today or earlier, so
// re-sending it on the next « Mettre à jour le contrat » would 422. The context
// keeps a freshly computed future date instead.
//
// On the 202 path (a sensitive change to an ACCEPTED contract) the history is
// left untouched and the pending clause rides in the embedded service request,
// so nothing is captured and the context value survives — which is correct.
const CONTRACT_SUBMISSION_PRODUCES: Array<{
  key: ContextKey;
  from: ProducerSpec;
}> = [
  { key: "date_of_effect", from: { kind: "bodyField", fields: ["date_of_effect"] } },
  {
    key: "beneficiary_clause_content",
    from: { kind: "bodyField", fields: ["beneficiary_clauses[-1].content"] },
  },
];

// The chosen product's catalogue, as dropdown options for the allocation leaves
// of a premium body. Shared by both premium steps (versement initial and
// versement périodique) so a fund is picked the same way in either — and so the
// automatic mode can prefetch a fund for both (see `stepNeedsFund` in
// lib/parcours-auto.ts, which recognises a step by this `fund_id` source).
const PREMIUM_FIELD_OPTIONS: FieldOptionSource[] = [
  {
    field: "fund_id",
    apiId: "product",
    operationId: "listProductFunds",
    params: [{ name: "product_id", from: "product_id" }],
    select: {
      collections: ["funds", "fund", "product_funds"],
      idFields: ["id", "fund_id", "isin"],
      labelFields: ["name", "label", "fund_name", "isin"],
      detailFields: ["isin", "category", "asset_class", "management_type"],
    },
  },
  {
    field: "preset_allocation_id",
    apiId: "product",
    operationId: "listProductPresetAllocations",
    params: [{ name: "product_id", from: "product_id" }],
    select: {
      collections: ["preset_allocations", "presetAllocations", "preset-allocations"],
      idFields: ["id", "preset_allocation_id"],
      labelFields: ["name", "label", "title"],
      detailFields: ["description", "risk_profile", "management_type"],
    },
  },
];

// One entry of `produces`: how to read a captured value out of the 2xx
// response body.
export type ProducerSpec =
  // First present field wins — tolerates the id-vs-<entity>_id naming drift
  // across the APIs (person uses `id`, payment-method `payment_method_id`, …).
  // Each entry is a PATH (lib/json-path), so a value nested in the response is
  // reachable: `beneficiary_clauses[-1].content` reads the last entry of the
  // clause history.
  | { kind: "bodyField"; fields: string[] }
  // Read `_embedded.service_requests[]` (any embedded array, defensively),
  // match on `type`, take the entry's id.
  | { kind: "embeddedSr"; srType: string };

// A "picker" step: the response carries a list; the user selects one row and
// its id is written to `key` in the context (so the next step is pre-filled).
export interface SelectSpec {
  key: ContextKey;
  /** Candidate collection names to locate the array of items (falls back to
   *  the first embedded/root array). */
  collections: string[];
  /** First present field wins for the item's id. */
  idFields: string[];
  /** First present field used as the human label (falls back to the id). */
  labelFields?: string[];
  /** Extra fields joined into a secondary line. */
  detailFields?: string[];
  /** Allow choosing several rows (stored as a comma-separated value). */
  multiSelect?: boolean;
}

// A source of dropdown options for a specific body field of a step. On step
// entry the page runs a GET (`apiId`/`operationId` with `params` resolved from
// the context) and turns the list response into options for the leaf named
// `field` — reusing `extractOptions` with the same collection/id/label rules as
// a picker step. Any field left without options falls back to a text input.
export interface FieldOptionSource {
  field: string;
  apiId: string;
  operationId: string;
  params: Array<{ name: string; from: ContextKey }>;
  select: Pick<SelectSpec, "collections" | "idFields" | "labelFields" | "detailFields">;
}

export interface ParcoursStep {
  id: string;
  phase: string;
  actor?: "Backoffice";
  apiId: string;
  operationId: string;
  title: string;
  description?: string;
  /** Skippable (e.g. versement périodique) — « Passer » in the step card, and in
   *  the automatic mode a step the user must tick to have it executed
   *  (`ParcoursState.autoOptional`). */
  optional?: boolean;
  /** An optional step the automatic mode runs UNCONDITIONALLY, without waiting
   *  for the user to tick it: « Mettre à jour le contrat » must run, because it
   *  is what puts the submission-required fields on the DRAFT. */
  autoRun?: boolean;
  /** Extra API ids a `custom` view calls directly (the document form uploads
   *  through the document API). The page checks these are synced before
   *  rendering the view, on top of the step's own `apiId`. */
  requiresApis?: string[];
  seedFrom?: SeedMapping[];
  produces?: Array<{ key: ContextKey; from: ProducerSpec }>;
  selects?: SelectSpec;
  /** Fetched option lists for named body leaves, turning free-text inputs into
   *  searchable dropdowns (e.g. a product's funds). Resolved on step entry. */
  fieldOptions?: FieldOptionSource[];
  /** Renders a bespoke component instead of the RequestBuilder (see
   *  app/parcours/page.tsx). "documents" → the requirements-driven upload form
   *  that analyses each SR's `requirements[]` and uploads+attaches per document;
   *  "decisions" → the reviewer's quick-decision view over the SRs of the
   *  current run (APPROVED / REJECTED inline, no list → consult → decide). */
  custom?: "documents" | "decisions";
}

export interface ParcoursDef {
  id: string;
  title: string;
  subtitle: string;
  steps: ParcoursStep[];
}

// --- the souscription parcours --------------------------------------------

const PHASE_A = "Phase A — Personne";
const PHASE_A_BIS = "Phase A bis — Moyen de paiement";
const PHASE_B = "Phase B — Contrat";
const PHASE_C = "Phase C — Compléter les Service Requests";
const PHASE_D = "Phase D — Décision & suivi";

const STEPS: ParcoursStep[] = [
  // ---- Phase A : personne (DRAFT → SUBMITTED) ------------------------------
  {
    id: "create-individual",
    phase: PHASE_A,
    apiId: "person",
    operationId: "createIndividual",
    title: "Créer la personne",
    description:
      "Renseignez le prénom, le nom et la date de naissance (first_name, last_name, birth). La personne est créée au statut DRAFT.",
    produces: [{ key: "person_id", from: { kind: "bodyField", fields: ["id", "person_id"] } }],
  },
  {
    id: "person-address",
    phase: PHASE_A,
    apiId: "person",
    operationId: "upsertPersonAddressByType",
    title: "Adresse principale",
    description:
      "Renseignez l'adresse principale : line1, postal_code, city, country_code.",
    seedFrom: [
      { target: "param", name: "person_id", from: "person_id" },
      { target: "param", name: "address_type", const: "PRINCIPAL" },
    ],
  },
  {
    id: "person-address-correspondence",
    phase: PHASE_A,
    apiId: "person",
    operationId: "upsertPersonAddressByType",
    title: "Adresse de correspondance (optionnel)",
    description:
      "Adresse de correspondance (address_type=CORRESPONDENCE) : mêmes champs que l'adresse principale (line1, postal_code, city, country_code). À passer si le courrier doit partir à l'adresse principale.",
    optional: true,
    seedFrom: [
      { target: "param", name: "person_id", from: "person_id" },
      { target: "param", name: "address_type", const: "CORRESPONDENCE" },
    ],
  },
  {
    id: "person-address-fiscal",
    phase: PHASE_A,
    apiId: "person",
    operationId: "upsertPersonAddressByType",
    title: "Adresse fiscale (optionnel)",
    description:
      "Adresse fiscale (address_type=FISCAL) : mêmes champs que l'adresse principale (line1, postal_code, city, country_code). À passer si l'adresse fiscale est identique à l'adresse principale.",
    optional: true,
    seedFrom: [
      { target: "param", name: "person_id", from: "person_id" },
      { target: "param", name: "address_type", const: "FISCAL" },
    ],
  },
  {
    id: "person-fiscal",
    phase: PHASE_A,
    apiId: "person",
    operationId: "upsertPersonFrenchResidency",
    title: "Résidence fiscale française",
    description:
      "Déclare la résidence fiscale française ; sa seule présence suffit, le corps de la requête est quasi vide.",
    seedFrom: [{ target: "param", name: "person_id", from: "person_id" }],
  },
  {
    id: "person-fatca",
    phase: PHASE_A,
    apiId: "person",
    operationId: "upsertPersonFatca",
    title: "FATCA (optionnel)",
    description:
      "Déclaration FATCA (Foreign Account Tax Compliance Act) pour un lien fiscal avec les États-Unis. Renseignez fiscal_type et, le cas échéant, le TIN américain. À passer si la personne n'a aucun lien fiscal américain.",
    optional: true,
    seedFrom: [{ target: "param", name: "person_id", from: "person_id" }],
  },
  {
    id: "person-crs",
    phase: PHASE_A,
    apiId: "person",
    operationId: "upsertPersonCrsByCountry",
    title: "CRS par pays (optionnel)",
    description:
      "Déclaration CRS (Common Reporting Standard) pour une résidence fiscale hors de France. Renseignez le pays (country_code, dans les paramètres) et le TIN correspondant. Répétez l'étape par pays si nécessaire ; à passer si la seule résidence fiscale est française.",
    optional: true,
    seedFrom: [{ target: "param", name: "person_id", from: "person_id" }],
  },
  {
    id: "person-bank-account",
    phase: PHASE_A,
    apiId: "person",
    operationId: "createBankAccount",
    title: "Compte bancaire",
    description:
      "Renseignez le compte bancaire : account_holder_name, iban, bic, currency, date_of_validity_start. C'est ce compte que le moyen de paiement SEPA référencera (son id est capté dans le contexte).",
    seedFrom: [{ target: "param", name: "person_id", from: "person_id" }],
    // The payment method references this account by id, so capture it.
    produces: [
      {
        key: "bank_account_id",
        from: { kind: "bodyField", fields: ["id", "bank_account_id"] },
      },
    ],
  },
  {
    id: "person-submit",
    phase: PHASE_A,
    apiId: "person",
    operationId: "submitPerson",
    title: "Soumettre la personne",
    description:
      "Soumet la personne : elle passe du statut DRAFT au statut SUBMITTED. Aucun corps de requête.",
    seedFrom: [{ target: "param", name: "person_id", from: "person_id" }],
  },

  // ---- Phase A bis : moyen de paiement -------------------------------------
  {
    id: "create-payment-method",
    phase: PHASE_A_BIS,
    apiId: "payment-method",
    operationId: "createPaymentMethod",
    title: "Créer le moyen de paiement (SEPA_DEBIT)",
    description:
      "Renseignez type=SEPA_DEBIT, bank_account_id, mandate_type et date_of_validity_start (ne renseignez ni rum — généré par le serveur — ni IBAN/BIC : ils appartiennent au compte bancaire, que le moyen de paiement référence par son id). Le bank_account_id est prérempli depuis l'étape « Compte bancaire ». La création ouvre automatiquement une demande de signature de mandat SEPA (service request SEPA_MANDATE_SIGNATURE).",
    seedFrom: [
      { target: "param", name: "person_id", from: "person_id" },
      { target: "body", name: "bank_account_id", from: "bank_account_id" },
    ],
    produces: [
      { key: "payment_method_id", from: { kind: "bodyField", fields: ["payment_method_id", "id"] } },
      { key: "rum", from: { kind: "bodyField", fields: ["rum"] } },
      { key: "sr_mandate_id", from: { kind: "embeddedSr", srType: "SEPA_MANDATE_SIGNATURE" } },
    ],
  },

  // ---- Phase B : contrat (produit → contrat → fonds/allocations → versements → submit) ----
  {
    id: "list-products",
    phase: PHASE_B,
    apiId: "product",
    operationId: "listProducts",
    title: "Lister les produits",
    description:
      "Choisissez le produit à souscrire : son product_id préremplira la création du contrat.",
    selects: {
      key: "product_id",
      collections: ["products", "product"],
      idFields: ["id", "product_id"],
      labelFields: ["name", "label", "product_name", "commercial_name", "title", "product_code"],
      detailFields: ["product_code", "tax_wrapper", "description"],
    },
  },
  {
    id: "create-contract",
    phase: PHASE_B,
    apiId: "contract",
    operationId: "createContract",
    title: "Créer le contrat",
    description:
      "Renseignez product_id (requis), subscriber_id et date_of_effect. Le contrat est créé au statut DRAFT. Pour compléter un contrat déjà créé, ne relancez pas cette étape (elle en créerait un nouveau) : utilisez « Mettre à jour le contrat ».",
    // date_of_effect + beneficiary_clause are required at submission (the submit
    // endpoint takes no body) and come from the context, so an edited value is
    // what both contract steps send.
    seedFrom: [
      { target: "body", name: "product_id", from: "product_id" },
      { target: "body", name: "subscriber_id", from: "person_id" },
      ...CONTRACT_SUBMISSION_SEEDS,
    ],
    produces: [
      { key: "contract_id", from: { kind: "bodyField", fields: ["id", "contract_id"] } },
      // What the created contract actually carries wins over the seeded default:
      // a clause the user typed here is echoed back and becomes the context
      // value « Mettre à jour le contrat » re-sends.
      ...CONTRACT_SUBMISSION_PRODUCES,
    ],
  },
  {
    id: "update-contract",
    phase: PHASE_B,
    apiId: "contract",
    operationId: "updateContract",
    title: "Mettre à jour le contrat (optionnel)",
    description:
      "Complète ou corrige le contrat DRAFT **existant** sans le recréer — mise à jour partielle : seuls les champs renseignés sont modifiés. Utilisez cette étape (et non « Créer le contrat », qui créerait un nouveau contrat et perdrait le contexte) pour ajouter un champ manquant avant la soumission : clause bénéficiaire (beneficiary_clause), date d'effet, garanties optionnelles, etc. Le contract_id est prérempli.",
    optional: true,
    // Skippable by hand, but the automatic mode must run it: it is what puts the
    // submission-required fields on a DRAFT that lost them.
    autoRun: true,
    // Same two fields as at creation, read from the context — so this step
    // completes a DRAFT without overwriting the designation the user settled on.
    seedFrom: [
      { target: "param", name: "contract_id", from: "contract_id" },
      ...CONTRACT_SUBMISSION_SEEDS,
    ],
    // On an ACCEPTED contract a sensitive change (e.g. beneficiary_clause)
    // returns 202 and opens a BENEFICIARY_CLAUSE_CHANGE service request; capture
    // its id so Phase C can attach documents to it. Absent on a DRAFT (200).
    produces: [
      {
        key: "sr_beneficiary_id",
        from: { kind: "embeddedSr", srType: "BENEFICIARY_CLAUSE_CHANGE" },
      },
      ...CONTRACT_SUBMISSION_PRODUCES,
    ],
  },
  // (The standalone « Lister les fonds » / « Lister les allocations
  // préconfigurées » steps were removed: funds and preset allocations are now
  // chosen inline in the versement-initial form via the step's `fieldOptions`.)
  {
    id: "create-premium",
    phase: PHASE_B,
    apiId: "contract",
    operationId: "createPremium",
    title: "Versement initial (one-time premium)",
    description:
      "Renseignez le montant (amount, requis) ; kind=SUBSCRIPTION. Ajoutez les fonds (« Ajouter » sous allocations.funds) et, en gestion pilotée, les allocations préconfigurées : choisissez chacun dans la liste du produit sélectionné, puis renseignez le taux (allocation_rate) de chaque ligne — la somme devant faire 100%.",
    seedFrom: [
      { target: "param", name: "contract_id", from: "contract_id" },
      { target: "body", name: "payment_method_id", from: "payment_method_id" },
    ],
    // Populate the fund_id / preset_allocation_id inputs of the allocations
    // arrays with the chosen product's catalogue (fetched on step entry).
    fieldOptions: PREMIUM_FIELD_OPTIONS,
    produces: [{ key: "premium_id", from: { kind: "bodyField", fields: ["id", "premium_id"] } }],
  },
  {
    id: "update-premium",
    phase: PHASE_B,
    apiId: "contract",
    operationId: "updatePremium",
    title: "Modifier le versement initial (optionnel)",
    description:
      "Modifie le versement initial (one-time premium) DRAFT **existant** sans le recréer, tant que le contrat n'est pas soumis — mise à jour partielle : seuls les champs renseignés sont modifiés (montant, allocations devant toujours sommer à 100%, etc.). contract_id et premium_id sont préremplis. Après soumission du contrat l'édition directe est verrouillée (409) : annulez le versement et recréez-en un.",
    optional: true,
    seedFrom: [
      { target: "param", name: "contract_id", from: "contract_id" },
      { target: "param", name: "premium_id", from: "premium_id" },
    ],
  },
  {
    id: "create-periodic-premium",
    phase: PHASE_B,
    apiId: "contract",
    operationId: "createPeriodicPremium",
    title: "Versement périodique (optionnel)",
    description:
      "Renseignez dates, periodic_amount et periodicity. Modifiable tant que le contrat n'est pas soumis, via « Modifier le versement périodique ».",
    optional: true,
    seedFrom: [
      { target: "param", name: "contract_id", from: "contract_id" },
      // Recurring collection needs the payment method, like the initial premium.
      { target: "body", name: "payment_method_id", from: "payment_method_id" },
    ],
    // Same catalogue pickers as the versement initial (see PREMIUM_FIELD_OPTIONS).
    fieldOptions: PREMIUM_FIELD_OPTIONS,
    produces: [{ key: "periodic_premium_id", from: { kind: "bodyField", fields: ["id", "periodic_premium_id"] } }],
  },
  {
    id: "update-periodic-premium",
    phase: PHASE_B,
    apiId: "contract",
    operationId: "updatePeriodicPremium",
    title: "Modifier le versement périodique (optionnel)",
    description:
      "Modifie le versement périodique DRAFT **existant** sans le recréer, tant que le contrat n'est pas soumis — mise à jour partielle : seuls les champs renseignés sont modifiés (dates, periodic_amount, periodicity, allocations devant toujours sommer à 100%). contract_id et periodic_premium_id sont préremplis. Après soumission du contrat l'édition directe est verrouillée (409) : annulez le versement et recréez-en un.",
    optional: true,
    seedFrom: [
      { target: "param", name: "contract_id", from: "contract_id" },
      { target: "param", name: "periodic_premium_id", from: "periodic_premium_id" },
    ],
  },
  {
    id: "submit-contract",
    phase: PHASE_B,
    apiId: "contract",
    operationId: "submitContract",
    title: "Soumettre le contrat",
    description:
      "Soumet le contrat : il passe du statut DRAFT au statut SUBMITTED. Le numéro de contrat (contract_number) est attribué et une demande de souscription (service request CONTRACT_SUBSCRIPTION) est ouverte.",
    seedFrom: [{ target: "param", name: "contract_id", from: "contract_id" }],
    produces: [
      { key: "contract_number", from: { kind: "bodyField", fields: ["contract_number"] } },
      { key: "sr_contract_id", from: { kind: "embeddedSr", srType: "CONTRACT_SUBSCRIPTION" } },
    ],
  },

  // ---- Phase C : compléter les Service Requests ----------------------------
  // A single custom step: after the contract is submitted, analyse each service
  // request's `requirements[]` and render one upload form per required document.
  // Each upload creates the document AND attaches it to the right SR in one go
  // (components/ParcoursDocuments.tsx), replacing the old manual
  // create-then-attach pair that had to be repeated once per document.
  {
    id: "complete-service-requests",
    phase: PHASE_C,
    custom: "documents",
    // A real operation on the SR API so the page's spec-resolution/gating still
    // validates the service-request contract is synced before rendering; the
    // uploads also go through the document API, hence `requiresApis`.
    apiId: "service-request",
    operationId: "getServiceRequestById",
    requiresApis: ["service-request", "document"],
    title: "Compléter les demandes (pièces justificatives)",
    description:
      "Pour chaque demande ouverte (souscription du contrat, signature du mandat SEPA, changement de clause bénéficiaire), les pièces requises sont analysées automatiquement. Téléversez chaque document demandé : il est créé puis rattaché à la bonne demande en une seule action. Lorsque toutes les pièces d'une demande sont fournies, celle-ci passe au statut UNDER_REVIEW.",
  },

  // ---- Phase D : décision back-office + suivi ------------------------------
  {
    id: "review-service-requests",
    phase: PHASE_D,
    actor: "Backoffice",
    // Replaces the former lister → consulter → décider triplet: one view over
    // the SRs of THIS run (context ids + a listServiceRequests filtered on each
    // target resource), deciding APPROVED / REJECTED in place. The reviewer
    // never sees the tenant's whole UNDER_REVIEW backlog, and never has to
    // carry an SR id from one step's response into the next step's form.
    custom: "decisions",
    // A real operation on the SR API so the page's spec-resolution/gating still
    // validates the service-request contract is synced before rendering.
    apiId: "service-request",
    operationId: "decideServiceRequest",
    requiresApis: ["service-request"],
    title: "Instruire les demandes (décision)",
    description:
      "Back-office (scope service-requests:admin) : les demandes ouvertes par ce parcours sont listées avec leur statut et leurs exigences. Approuvez ou rejetez chacune directement — la décision est un 204, la demande est relue aussitôt pour afficher son nouveau statut. Un retour pour information (RETURNED_FOR_INFORMATION), qui exige de composer requirements[], reste à faire depuis l'endpoint « Décider » de l'API service-request.",
  },
  {
    id: "poll-contract",
    phase: PHASE_D,
    apiId: "contract",
    operationId: "getContractById",
    title: "Suivre le contrat",
    description:
      "Après la décision : le contrat passe au statut ACCEPTED (approuvé) ou REJECTED.",
    seedFrom: [{ target: "param", name: "contract_id", from: "contract_id" }],
  },
  {
    id: "poll-person",
    phase: PHASE_D,
    apiId: "person",
    operationId: "getIndividualById",
    title: "Suivre la personne",
    description:
      "En cas d'approbation, le souscripteur passe au statut ENGAGED (définitif).",
    seedFrom: [{ target: "param", name: "person_id", from: "person_id" }],
  },
];

export const SOUSCRIPTION_PARCOURS: ParcoursDef = {
  id: "souscription",
  title: "Parcours de souscription",
  subtitle:
    "Enchaînez les APIs dans l'ordre : personne → moyen de paiement → contrat (produit, fonds, versements) → service requests → décision & suivi.",
  steps: STEPS,
};

export const PARCOURS: Record<string, ParcoursDef> = {
  [SOUSCRIPTION_PARCOURS.id]: SOUSCRIPTION_PARCOURS,
};

export function getParcours(id: string): ParcoursDef | null {
  return PARCOURS[id] ?? null;
}

// --- seeding ---------------------------------------------------------------

// Build the ImportSeed a step's RequestBuilder should consume, resolving each
// mapping against the current context. Returns undefined when nothing can be
// pre-filled (so the builder starts empty, as usual).
// `bodySchema` is optional: when the caller has the operation's request schema
// (the parcours auto/semi modes do), a seed value is coerced to the leaf's
// declared type, so seeding a numeric or boolean leaf doesn't post a string.
// Without it, values stay strings — which is what every seeded leaf so far is.
export function buildSeedForStep(
  step: ParcoursStep,
  values: ContextValues,
  bodySchema?: JsonSchema,
): ImportSeed | undefined {
  if (!step.seedFrom?.length) return undefined;
  const params: Record<string, string> = {};
  let body: Record<string, unknown> = {};
  let hasParam = false;
  let hasBody = false;
  for (const m of step.seedFrom) {
    const value = "const" in m ? m.const : values[m.from];
    if (value == null || value === "") continue;
    if (m.target === "param") {
      params[m.name] = value;
      hasParam = true;
    } else {
      // `name` is a path, so a nested leaf (beneficiary_clause.content) builds
      // the intermediate objects it needs.
      body = setAtPath(body, m.name, coerceSeedValue(value, bodySchema, m.name));
      hasBody = true;
    }
  }
  if (!hasParam && !hasBody) return undefined;
  return {
    apiId: step.apiId,
    operationId: step.operationId,
    ...(hasParam ? { params } : {}),
    ...(hasBody ? { body } : {}),
  };
}

function coerceSeedValue(
  value: string,
  bodySchema: JsonSchema | undefined,
  path: string,
): unknown {
  if (!bodySchema) return value;
  return coerceToSchema(value, schemaAtPath(bodySchema, path));
}

// A step's restored draft, minus the pre-filled values that have gone STALE.
//
// A draft is a snapshot of the form as the user left the step, so a context-fed
// field in it can be an id captured under a previous contract/person (« Créer le
// contrat » re-run, a re-picked product, a second automatic run). The
// RequestBuilder restores that snapshot at mount and then refuses to overwrite
// any non-empty value it didn't seed itself, which would pin the stale id for
// good — so those fields are dropped here and the live seed re-supplies them.
//
// A field is only dropped when the draft still holds exactly what was seeded
// into it (`draft.seeded`, recorded on every save): an untouched pre-fill, safe
// to refresh. A value the user typed over differs from the seeded one and is
// kept — including a `beneficiary_clause` or `date_of_effect` edited away from
// its default, and an id deliberately pointed at another resource.
//
// A draft saved before seeds were recorded (`seeded` absent — only possible
// within a session started on an older build) falls back to dropping, which is
// what the stale-id case needs.
// Comparison is per LEAF PATH, not per top-level key: a seed now reaches
// `beneficiary_clause.content`, so a clause whose content the user retyped must
// be kept while its untouched sibling date is still refreshable.
export function draftWithoutSeededFields(
  step: ParcoursStep,
  values: ContextValues,
  draft: StepDraft | undefined,
): StepDraft | undefined {
  if (!draft) return undefined;
  const current = seedSnapshot(step, values);
  const { seeded, ...rest } = draft;
  // Drop `path` when the context can re-supply it and the draft's value is still
  // the one seeded there (or predates seed recording).
  const isStale = (
    target: "params" | "body",
    path: string,
    value: unknown,
  ): boolean => {
    const now = current?.[target]?.[path];
    if (now === undefined) return false; // nothing to put in its place
    const was = seeded?.[target]?.[path];
    return was === undefined || was === value;
  };
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(rest.params ?? {}))
    if (!isStale("params", k, v)) params[k] = v;
  let body = rest.body;
  if (asRecord(body) || Array.isArray(body))
    body = pruneSeededLeaves(body, [], (path, v) => isStale("body", path, v));
  return {
    ...(Object.keys(params).length ? { params } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

// Drop the stale leaves of a draft body, walking it STRUCTURALLY.
//
// Deliberately not `flattenLeaves` → `setAtPath`: that round-trip renders every
// key into a path string and parses it back, so an object key that looks like a
// path separator or an index does not survive it — a map keyed "1"/"2" (the body
// form's MapField accepts any key) came back as an array, losing the keys. Here a
// key is only ever used as a key; the path string is built for the staleness
// LOOKUP alone, never to reconstruct the value.
//
// Array elements keep their positions: only leaves are dropped, never elements,
// so an index-addressed seed can't shift the rest of a list.
function pruneSeededLeaves(
  value: unknown,
  segs: PathSeg[],
  isStale: (path: string, value: unknown) => boolean,
): unknown {
  if (Array.isArray(value))
    return value.map((v, i) => pruneSeededLeaves(v, [...segs, i], isStale));
  const rec = asRecord(value);
  if (!rec) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    const childSegs = [...segs, k];
    // Only leaves are comparable: a `SeedMapping` value is always a string, so a
    // container never appears in the snapshot and is kept (its own leaves having
    // already been pruned).
    if (isLeafValue(v) && isStale(formatPath(childSegs), v)) continue;
    out[k] = pruneSeededLeaves(v, childSegs, isStale);
  }
  return out;
}

// --- capture ---------------------------------------------------------------

export function isSuccess(res: ProxyResponse): boolean {
  return res.status >= 200 && res.status < 300;
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function coerceId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

// Read the id of the last path segment of a HAL self href, e.g.
// "/service-requests/abc-123" → "abc-123". Fallback when an embedded SR
// preview carries no explicit `id`.
function idFromSelfHref(entry: Record<string, unknown>): string | null {
  const links = asRecord(entry._links);
  const self = links && asRecord(links.self);
  const href = self && typeof self.href === "string" ? self.href : null;
  if (!href) return null;
  const seg = href.split("?")[0].split("/").filter(Boolean).pop();
  return seg ?? null;
}

function findEmbeddedSr(body: unknown, srType: string): string | null {
  const root = asRecord(body);
  const embedded = root && asRecord(root._embedded);
  if (!embedded) return null;
  // Prefer the documented `service_requests` array, but scan any embedded
  // array so a differently-named collection still resolves.
  const candidates: unknown[] = [];
  const named = embedded.service_requests;
  if (Array.isArray(named)) candidates.push(...named);
  else
    for (const v of Object.values(embedded))
      if (Array.isArray(v)) candidates.push(...v);
  for (const raw of candidates) {
    const entry = asRecord(raw);
    if (!entry) continue;
    if (entry.type !== srType) continue;
    return coerceId(entry.id) ?? idFromSelfHref(entry);
  }
  return null;
}

// Apply a step's `produces` to its response body, returning the captured
// values. Callers merge this into the parcours context.
export function extractProduced(
  step: ParcoursStep,
  res: ProxyResponse,
): ContextValues {
  const out: ContextValues = {};
  if (!step.produces?.length || !isSuccess(res)) return out;
  const body = asRecord(res.body);
  for (const p of step.produces) {
    if (p.from.kind === "bodyField") {
      if (!body) continue;
      for (const field of p.from.fields) {
        // A path, so a nested/array-indexed value is reachable
        // (`beneficiary_clauses[-1].content`).
        const id = coerceId(getAtPath(body, field));
        if (id) {
          out[p.key] = id;
          break;
        }
      }
    } else {
      const id = findEmbeddedSr(res.body, p.from.srType);
      if (id) out[p.key] = id;
    }
  }
  return out;
}

export interface SelectOption {
  id: string;
  label: string;
  detail?: string;
}

function firstArray(obj: Record<string, unknown>): unknown[] | null {
  for (const v of Object.values(obj)) if (Array.isArray(v)) return v;
  return null;
}

// Locate a collection in a response body: one of the named arrays under
// `_embedded`, else at the root, else (opt-in) the first array found anywhere in
// either — the HAL shape every list/collection reader in the app needs. Shared
// by the picker options, the SR requirements and the SR collection so a shape
// quirk fixed once is fixed everywhere.
export function findCollectionArray(
  body: unknown,
  names: string[],
  opts: { anyArrayFallback?: boolean } = {},
): unknown[] | null {
  if (Array.isArray(body)) return body;
  const root = asRecord(body);
  if (!root) return null;
  const embedded = asRecord(root._embedded);
  for (const name of names) {
    if (embedded && Array.isArray(embedded[name])) return embedded[name];
    if (Array.isArray(root[name])) return root[name];
  }
  if (!opts.anyArrayFallback) return null;
  return (embedded && firstArray(embedded)) ?? firstArray(root);
}

function firstString(
  item: Record<string, unknown>,
  fields?: string[],
): string | undefined {
  if (!fields) return undefined;
  for (const f of fields) {
    const v = item[f];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function joinStrings(
  item: Record<string, unknown>,
  fields?: string[],
): string | undefined {
  if (!fields) return undefined;
  const parts: string[] = [];
  for (const f of fields) {
    const v = item[f];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (typeof v === "number") parts.push(String(v));
  }
  return parts.length ? parts.join(" · ") : undefined;
}

// Extract selectable rows from a list response for a picker step. Looks for the
// named collection(s) under `_embedded` or at the root, falling back to the
// first array found; returns {id,label,detail} rows (items with no id skipped).
export function extractOptions(
  body: unknown,
  spec: Pick<SelectSpec, "collections" | "idFields" | "labelFields" | "detailFields">,
): SelectOption[] {
  const items = findCollectionArray(body, spec.collections, {
    anyArrayFallback: true,
  });
  if (!items) return [];
  const out: SelectOption[] = [];
  for (const raw of items) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = firstString(item, spec.idFields);
    if (!id) continue;
    out.push({
      id,
      label: firstString(item, spec.labelFields) ?? id,
      detail: joinStrings(item, spec.detailFields),
    });
  }
  return out;
}

// --- persisted state -------------------------------------------------------

export const PARCOURS_STATE_KEY = "packrest.parcours";

// A per-step form snapshot (params + JSON body) captured when the user leaves a
// step, so returning restores what was typed. Files are not serialisable and
// are omitted (re-picked on return).
export interface StepDraft {
  params?: Record<string, string>;
  body?: unknown;
  /** The context-fed values the form had been SEEDED with when this snapshot was
   *  taken (see `seedSnapshot`). Comparing a restored field against it tells a
   *  value the user typed over the pre-fill (keep it) from an untouched pre-fill
   *  that has since gone stale (let the live context re-supply it) — see
   *  `draftWithoutSeededFields`. */
  seeded?: SeedSnapshot;
}

/** Seeded values per target, keyed by the mapping's PATH (both are strings: a
 *  context value or a `const` mapping). Body keys are leaf paths, matching what
 *  `flattenLeaves` produces for a restored draft. */
export interface SeedSnapshot {
  params?: Record<string, string>;
  body?: Record<string, string>;
}

// The seed a step would receive right now, flattened for storage next to a
// draft. Recorded on every draft save so the next restore can tell an edit from
// a stale pre-fill.
export function seedSnapshot(
  step: ParcoursStep,
  values: ContextValues,
): SeedSnapshot | undefined {
  const params: Record<string, string> = {};
  const body: Record<string, string> = {};
  for (const m of step.seedFrom ?? []) {
    const value = "const" in m ? m.const : values[m.from];
    if (value == null || value === "") continue;
    if (m.target === "param") params[m.name] = value;
    else body[m.name] = value;
  }
  if (!Object.keys(params).length && !Object.keys(body).length) return undefined;
  return {
    ...(Object.keys(params).length ? { params } : {}),
    ...(Object.keys(body).length ? { body } : {}),
  };
}

// True when a body value carries content — a non-empty object/array or any
// primitive. An untouched form serialises its body to null/undefined/{}.
export function bodyHasContent(b: unknown): boolean {
  return (
    b != null &&
    (typeof b !== "object" || Array.isArray(b) || Object.keys(b).length > 0)
  );
}

// The run mode chosen in the mode panel. "manual" = empty forms the user fills
// and sends; "semi" = each step's form pre-filled with random-but-plausible data
// (the user reviews then sends step by step); "auto" = the runner drives every
// step end to end (lib/parcours-auto).
export type ParcoursMode = "manual" | "semi" | "auto";

export interface ParcoursState {
  parcoursId: string;
  values: ContextValues;
  /** Step ids that have completed (executed 2xx or been skipped). */
  done: string[];
  /** The step currently open in the builder. */
  currentStepId: string;
  /** Per-step form drafts (keyed by step id) so a return doesn't wipe input. */
  drafts?: Record<string, StepDraft>;
  /** Selected run mode (default "manual"). */
  mode?: ParcoursMode;
  /** Stable random identity/bank details generated once for the semi-automatic
   *  mode, so consecutive pre-filled steps agree (same person, same IBAN). */
  autoSeed?: AutoSeed;
  /** Step ids the semi-automatic mode has already pre-filled once, so a return
   *  never re-fills over the user's edits (or a deliberate clear). Reset when a
   *  fresh autoSeed is generated. */
  semiPrefilled?: string[];
  /** Ids of the `optional` steps the automatic mode must EXECUTE. Every other
   *  optional step is marked done without a call, exactly like « Passer » — so
   *  an absent/empty list keeps the historical behaviour (nothing optional
   *  runs). Steps declaring `autoRun` always run and are not listed here. */
  autoOptional?: string[];
}

// The context values a run starts with: the two fields the submit endpoint
// requires but takes no body for, so they are on the contract from the first
// « Créer le contrat » onwards — in every mode, and editable like any other
// context value.
export function defaultContextValues(): ContextValues {
  return {
    date_of_effect: defaultDateOfEffect(),
    beneficiary_clause_content: DEFAULT_BENEFICIARY_CLAUSE,
    beneficiary_clause_date_of_effect: defaultClauseDateOfEffect(),
  };
}

/** The clause was a single string until the contracts made it
 *  `{content, date_of_effect}`. A session persisted before that carries the old
 *  key; move its text to the content key so a run in progress keeps the
 *  designation the user settled on. Also refreshes a clause date that is no
 *  longer strictly in the future (a session that crossed midnight, or one
 *  restored from an earlier day), which would otherwise 422. */
export function migrateContextValues(values: ContextValues): ContextValues {
  const legacy = (values as Record<string, unknown>).beneficiary_clause;
  const next: ContextValues = { ...values };
  delete (next as Record<string, unknown>).beneficiary_clause;
  if (typeof legacy === "string" && legacy && !next.beneficiary_clause_content)
    next.beneficiary_clause_content = legacy;
  // Refresh a clause date that has gone stale, but NEVER resurrect one the user
  // emptied on purpose: an absent key means "no value yet", `""` means "don't
  // send this" (and `buildSeedForStep` honours that by omitting the leaf). Same
  // rule `loadParcoursState` states for every other context value — only missing
  // keys are filled, never empty ones.
  const clauseDate = next.beneficiary_clause_date_of_effect;
  if (clauseDate !== "" && !isFutureDate(clauseDate))
    next.beneficiary_clause_date_of_effect = defaultClauseDateOfEffect();
  return next;
}

export function initialState(def: ParcoursDef): ParcoursState {
  return {
    parcoursId: def.id,
    values: defaultContextValues(),
    done: [],
    currentStepId: def.steps[0]?.id ?? "",
    drafts: {},
    mode: "manual",
  };
}

// Load persisted state for a parcours; returns a fresh state when absent,
// unparseable, or for a different parcours. sessionStorage so an in-progress
// parcours survives navigation/refresh but not a new session.
export function loadParcoursState(def: ParcoursDef): ParcoursState {
  try {
    const raw = window.sessionStorage.getItem(PARCOURS_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ParcoursState;
      if (
        parsed.parcoursId === def.id &&
        parsed.currentStepId &&
        def.steps.some((s) => s.id === parsed.currentStepId)
      )
        // Back-fill defaults absent from a state persisted before a key existed
        // (a run in progress must not lose its submission-required fields),
        // without touching a value the user has since cleared on purpose… which
        // an absent key is indistinguishable from — so only missing keys are
        // filled, never empty ones.
        return {
          ...parsed,
          // Migrate BEFORE filling defaults: the legacy clause string must land
          // in the content key while that key is still empty, or the default
          // would mask it.
          values: {
            ...defaultContextValues(),
            ...migrateContextValues(parsed.values ?? {}),
          },
          // Drop ids of steps that no longer exist or are no longer optional, so
          // a renamed step doesn't linger as a phantom selection for the session.
          ...(parsed.autoOptional
            ? {
                autoOptional: parsed.autoOptional.filter((id) =>
                  def.steps.some((s) => s.id === id && s.optional),
                ),
              }
            : {}),
        };
    }
  } catch {
    /* private mode / bad JSON → fresh */
  }
  return initialState(def);
}

export function saveParcoursState(state: ParcoursState): void {
  try {
    window.sessionStorage.setItem(PARCOURS_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function clearParcoursState(): void {
  try {
    window.sessionStorage.removeItem(PARCOURS_STATE_KEY);
  } catch {
    /* ignore */
  }
}

// Context ids scoped to a specific contract: when contract_id changes to a
// different contract (re-running « Créer le contrat », or editing it by hand),
// these no longer apply and must be dropped so a later step (e.g. update-premium)
// never seeds an id captured under the previous contract.
const CONTRACT_SCOPED_KEYS: ContextKey[] = [
  "contract_number",
  "premium_id",
  "periodic_premium_id",
  "sr_contract_id",
  "sr_beneficiary_id",
];

// Same idea for values scoped to a specific person: when person_id changes,
// the captured name belongs to the previous person and must not leak into
// later requests (e.g. the auto-run's account_holder_name).
const PERSON_SCOPED_KEYS: ContextKey[] = ["person_name", "bank_account_id"];

// Merge captured/edited values into the context. When `incoming` sets a
// contract_id (resp. person_id) different from the current one, ids scoped to
// the previous contract (resp. person) that aren't themselves part of this
// batch are cleared. Values present in `incoming` always win and are never
// cleared.
export function mergeContextValues(
  prev: ContextValues,
  incoming: ContextValues,
): ContextValues {
  const next: ContextValues = { ...prev, ...incoming };
  const scopes: Array<{ owner: ContextKey; keys: ContextKey[] }> = [
    { owner: "contract_id", keys: CONTRACT_SCOPED_KEYS },
    { owner: "person_id", keys: PERSON_SCOPED_KEYS },
  ];
  for (const { owner, keys } of scopes) {
    const nextOwner = incoming[owner];
    const changed =
      nextOwner != null &&
      nextOwner !== "" &&
      prev[owner] != null &&
      prev[owner] !== "" &&
      nextOwner !== prev[owner];
    if (changed) {
      for (const k of keys) {
        if (!(k in incoming)) delete next[k];
      }
    }
  }
  return next;
}

// After a step succeeds (or is skipped), mark it done and advance the cursor to
// the earliest not-yet-done step (naturally handles re-running an earlier step
// without jumping the user backwards or past their progress).
export function advanceState(
  state: ParcoursState,
  def: ParcoursDef,
  completedStepId: string,
  produced: ContextValues,
): ParcoursState {
  const done = state.done.includes(completedStepId)
    ? state.done
    : [...state.done, completedStepId];
  const next =
    def.steps.find((s) => !done.includes(s.id))?.id ?? completedStepId;
  return {
    ...state,
    values: mergeContextValues(state.values, produced),
    done,
    currentStepId: next,
  };
}

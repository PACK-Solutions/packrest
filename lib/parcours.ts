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

// The values that flow between steps. Some are user-picked while browsing the
// catalogue (product_id); the rest are captured from POST/submit
// responses. All are stored (and edited) as strings.
export type ContextKey =
  | "product_id"
  | "person_id"
  | "payment_method_id"
  | "rum"
  | "contract_id"
  | "contract_number"
  | "sr_contract_id"
  | "sr_mandate_id"
  | "premium_id"
  | "periodic_premium_id"
  | "sr_beneficiary_id";

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
  { key: "payment_method_id", label: "payment_method_id" },
  { key: "rum", label: "rum" },
  { key: "contract_id", label: "contract_id" },
  { key: "contract_number", label: "contract_number" },
  { key: "premium_id", label: "premium_id (versement initial)" },
  { key: "periodic_premium_id", label: "periodic_premium_id" },
  { key: "sr_contract_id", label: "SR contrat (id)" },
  { key: "sr_mandate_id", label: "SR mandat SEPA (id)" },
  { key: "sr_beneficiary_id", label: "SR clause bénéficiaire (id)" },
];

export type ContextValues = Partial<Record<ContextKey, string>>;

// --- step definition -------------------------------------------------------

// One entry of `seedFrom`: put a value into the request before the user sees
// it. The value comes either from the parcours context (`from`) or is a fixed
// literal (`const`, e.g. address_type = PRINCIPAL, status = UNDER_REVIEW).
export type SeedMapping =
  | ({ target: "param" | "body"; name: string } & (
      | { from: ContextKey }
      | { const: string }
    ));

// One entry of `produces`: how to read a captured value out of the 2xx
// response body.
export type ProducerSpec =
  // First present field wins — tolerates the id-vs-<entity>_id naming drift
  // across the APIs (person uses `id`, payment-method `payment_method_id`, …).
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
  /** Skippable (e.g. versement périodique). */
  optional?: boolean;
  seedFrom?: SeedMapping[];
  produces?: Array<{ key: ContextKey; from: ProducerSpec }>;
  selects?: SelectSpec;
  /** Fetched option lists for named body leaves, turning free-text inputs into
   *  searchable dropdowns (e.g. a product's funds). Resolved on step entry. */
  fieldOptions?: FieldOptionSource[];
  /** Renders a bespoke component instead of the RequestBuilder (see
   *  app/parcours/page.tsx). "documents" → the requirements-driven upload form
   *  that analyses each SR's `requirements[]` and uploads+attaches per document. */
  custom?: "documents";
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
      "Renseignez le compte bancaire : account_holder_name, iban, currency, date_of_validity_start.",
    seedFrom: [{ target: "param", name: "person_id", from: "person_id" }],
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
      "Renseignez type=SEPA_DEBIT, iban, bic, mandate_type et date_of_validity_start (ne renseignez pas rum). La création ouvre automatiquement une demande de signature de mandat SEPA (service request SEPA_MANDATE_SIGNATURE).",
    seedFrom: [{ target: "param", name: "person_id", from: "person_id" }],
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
    seedFrom: [
      { target: "body", name: "product_id", from: "product_id" },
      { target: "body", name: "subscriber_id", from: "person_id" },
    ],
    produces: [{ key: "contract_id", from: { kind: "bodyField", fields: ["id", "contract_id"] } }],
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
    seedFrom: [{ target: "param", name: "contract_id", from: "contract_id" }],
    // On an ACCEPTED contract a sensitive change (e.g. beneficiary_clause)
    // returns 202 and opens a BENEFICIARY_CLAUSE_CHANGE service request; capture
    // its id so Phase C can attach documents to it. Absent on a DRAFT (200).
    produces: [
      {
        key: "sr_beneficiary_id",
        from: { kind: "embeddedSr", srType: "BENEFICIARY_CLAUSE_CHANGE" },
      },
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
    fieldOptions: [
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
    ],
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
    seedFrom: [{ target: "param", name: "contract_id", from: "contract_id" }],
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
    // validates the service-request contract is synced before rendering.
    apiId: "service-request",
    operationId: "getServiceRequestById",
    title: "Compléter les demandes (pièces justificatives)",
    description:
      "Pour chaque demande ouverte (souscription du contrat, signature du mandat SEPA, changement de clause bénéficiaire), les pièces requises sont analysées automatiquement. Téléversez chaque document demandé : il est créé puis rattaché à la bonne demande en une seule action. Lorsque toutes les pièces d'une demande sont fournies, celle-ci passe au statut UNDER_REVIEW.",
  },

  // ---- Phase D : décision back-office + suivi ------------------------------
  {
    id: "list-under-review",
    phase: PHASE_D,
    actor: "Backoffice",
    apiId: "service-request",
    operationId: "listServiceRequests",
    title: "Lister les demandes à instruire",
    description:
      "Back-office : liste des demandes en attente d'instruction (statut UNDER_REVIEW). Sélectionnez dans la liste la demande à instruire : son id préremplit la consultation et la décision. Revenez sur cette étape pour instruire une autre demande une fois la précédente traitée.",
    seedFrom: [{ target: "param", name: "status", const: "UNDER_REVIEW" }],
    // Turn the response into a picker so the reviewer chooses which SR to
    // instruct; the chosen id feeds « Consulter » and « Décider ». Re-run this
    // step (via the stepper) to pick a different SR after deciding one.
    selects: {
      key: "sr_contract_id",
      collections: ["service_requests"],
      idFields: ["id"],
      labelFields: ["type"],
      detailFields: ["status", "reason", "id"],
    },
  },
  {
    id: "get-service-request",
    phase: PHASE_D,
    actor: "Backoffice",
    apiId: "service-request",
    operationId: "getServiceRequestById",
    title: "Consulter le détail de la demande",
    description:
      "Consulte le détail de la demande : requirements et documents rattachés.",
    seedFrom: [{ target: "param", name: "service_request_id", from: "sr_contract_id" }],
  },
  {
    id: "decide-service-request",
    phase: PHASE_D,
    actor: "Backoffice",
    apiId: "service-request",
    operationId: "decideServiceRequest",
    title: "Décider (APPROVED / REJECTED)",
    description:
      "Nécessite le scope service-requests:admin. Choisissez outcome=APPROVED, ou REJECTED avec rejection_reasons[]. La réponse est un 204 : reconsultez la demande pour observer son nouveau statut. Un outcome RETURNED_FOR_INFORMATION rouvre la demande (retour à la Phase C).",
    seedFrom: [{ target: "param", name: "service_request_id", from: "sr_contract_id" }],
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
export function buildSeedForStep(
  step: ParcoursStep,
  values: ContextValues,
): ImportSeed | undefined {
  if (!step.seedFrom?.length) return undefined;
  const params: Record<string, string> = {};
  const body: Record<string, unknown> = {};
  let hasParam = false;
  let hasBody = false;
  for (const m of step.seedFrom) {
    // (Body-list expansion was removed with the fund/preset picker steps; the
    // premium now populates allocations inline via fetched field options.)
    const value = "const" in m ? m.const : values[m.from];
    if (value == null || value === "") continue;
    if (m.target === "param") {
      params[m.name] = value;
      hasParam = true;
    } else {
      body[m.name] = value;
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
        const id = coerceId(body[field]);
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
  let items: unknown[] | null = null;
  const root = asRecord(body);
  if (Array.isArray(body)) items = body;
  else if (root) {
    const embedded = asRecord(root._embedded);
    for (const name of spec.collections) {
      if (embedded && Array.isArray(embedded[name])) {
        items = embedded[name] as unknown[];
        break;
      }
      if (Array.isArray(root[name])) {
        items = root[name] as unknown[];
        break;
      }
    }
    if (!items && embedded) items = firstArray(embedded);
    if (!items) items = firstArray(root);
  }
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
}

export interface ParcoursState {
  parcoursId: string;
  values: ContextValues;
  /** Step ids that have completed (executed 2xx or been skipped). */
  done: string[];
  /** The step currently open in the builder. */
  currentStepId: string;
  /** Per-step form drafts (keyed by step id) so a return doesn't wipe input. */
  drafts?: Record<string, StepDraft>;
}

export function initialState(def: ParcoursDef): ParcoursState {
  return {
    parcoursId: def.id,
    values: {},
    done: [],
    currentStepId: def.steps[0]?.id ?? "",
    drafts: {},
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
        return parsed;
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

// Merge captured/edited values into the context. When `incoming` sets a
// contract_id different from the current one, contract-scoped ids that aren't
// themselves part of this batch are cleared (they belonged to the old contract).
// Values present in `incoming` always win and are never cleared.
export function mergeContextValues(
  prev: ContextValues,
  incoming: ContextValues,
): ContextValues {
  const next: ContextValues = { ...prev, ...incoming };
  const nextContract = incoming.contract_id;
  const changedContract =
    nextContract != null &&
    nextContract !== "" &&
    prev.contract_id != null &&
    prev.contract_id !== "" &&
    nextContract !== prev.contract_id;
  if (changedContract) {
    for (const k of CONTRACT_SCOPED_KEYS) {
      if (!(k in incoming)) delete next[k];
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

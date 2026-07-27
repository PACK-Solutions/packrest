// Pure analysis + payload building for the Parcours quick-decision view
// (components/ParcoursDecisions.tsx), the Phase D step that instructs the
// service requests of the *current* parcours run without going through the
// list → consult → decide operations one form at a time.
//
// Kept free of React and network (like lib/parcours-documents.ts) so the
// reading of a reviewer-facing SR, the decidability rule and the polymorphic
// decision body can be unit-tested in isolation.
//
// The decision endpoint (POST /service-requests/{id}/decisions, scope
// `service-requests:admin`) is polymorphic on `outcome`:
//   • APPROVED → { outcome }                                   — terminal
//   • REJECTED → { outcome, rejection_reasons: [{code, message}] } — terminal
//   • RETURNED_FOR_INFORMATION → { outcome, requirements[] }    — non-terminal,
//     left to the raw endpoint (it needs a requirements[] to author).
// All three answer 204, so the caller re-reads the SR to see the new status.

import { asRecord, findCollectionArray, type ContextKey } from "@/lib/parcours";
import {
  extractRequirements,
  isRequirementBlocking,
  type Requirement,
} from "@/lib/parcours-documents";

/** The only status that accepts a decision — anything else answers 409. */
export const DECIDABLE_STATUS = "UNDER_REVIEW";

/** Outcomes the quick view offers (both terminal). */
export type QuickDecisionOutcome = "APPROVED" | "REJECTED";

/** `RejectionReasonCode` of the service-request contract, with its French
 *  label and the default message pre-filled so a rejection stays one click
 *  away (the contract requires a non-empty message). */
export const REJECTION_REASONS = [
  {
    code: "INADEQUATE_DOCUMENT",
    label: "Pièce inadéquate",
    message: "La pièce fournie n'est pas adéquate.",
  },
  {
    code: "UNREADABLE_DOCUMENT",
    label: "Pièce illisible",
    message: "La pièce fournie est illisible et ne peut être vérifiée.",
  },
  {
    code: "EXPIRED_DOCUMENT",
    label: "Pièce expirée",
    message: "La pièce fournie est expirée.",
  },
  {
    code: "MISSING_INFORMATION",
    label: "Information manquante",
    message: "Une information requise est manquante.",
  },
  {
    code: "INCONSISTENT_DATA",
    label: "Données incohérentes",
    message: "Les données fournies sont incohérentes avec nos enregistrements.",
  },
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASONS)[number]["code"];

export function defaultRejectionMessage(code: string): string {
  return REJECTION_REASONS.find((r) => r.code === code)?.message ?? "";
}

// French labels for `ServiceRequestType`. Shared with the Phase C document
// form's card headers so an SR is named the same way throughout the parcours.
export const SR_TYPE_LABELS: Record<string, string> = {
  CONTRACT_SUBSCRIPTION: "Souscription du contrat",
  SEPA_MANDATE_SIGNATURE: "Signature du mandat SEPA",
  BENEFICIARY_CLAUSE_CHANGE: "Changement de clause bénéficiaire",
  CONTRACT_RENUNCIATION: "Renonciation au contrat",
  PREMIUM_PAYMENT: "Versement complémentaire",
  ADDRESS_CHANGE: "Changement d'adresse",
  NAME_CHANGE: "Changement de nom",
  FAMILY_STATUS_CHANGE: "Changement de situation familiale",
  BANK_ACCOUNT_CHANGE: "Changement de compte bancaire",
};

/** Context keys holding an SR id — a subset of ContextKey, so a typo is a
 *  compile error rather than a silently unnamed card. */
export type ContextSrKey = Extract<
  ContextKey,
  "sr_contract_id" | "sr_mandate_id" | "sr_beneficiary_id"
>;

/** SR type each parcours context key holds the id of. */
export const CONTEXT_SR_TYPES: Record<ContextSrKey, string> = {
  sr_contract_id: "CONTRACT_SUBSCRIPTION",
  sr_mandate_id: "SEPA_MANDATE_SIGNATURE",
  sr_beneficiary_id: "BENEFICIARY_CLAUSE_CHANGE",
};

export const CONTEXT_SR_KEYS = Object.keys(
  CONTEXT_SR_TYPES,
) as ContextSrKey[];

/** The context key an SR of this type belongs in — used to write an id the run
 *  lost (or never captured) back into the context, which the removed picker step
 *  used to do. */
export function contextKeyForSrType(
  type: string | null | undefined,
): ContextSrKey | null {
  if (!type) return null;
  return CONTEXT_SR_KEYS.find((k) => CONTEXT_SR_TYPES[k] === type) ?? null;
}

/** Human label for an SR type (falls back to the raw type). */
export function srTypeLabel(type: string | null | undefined): string {
  if (!type) return "Demande";
  return SR_TYPE_LABELS[type] ?? type;
}

export interface RejectionEntry {
  code: string;
  message: string;
}

/** A reviewer-facing service request, as the quick-decision view needs it. */
export interface ServiceRequestRow {
  id: string;
  type: string | null;
  status: string | null;
  reason: string | null;
  targetType: string | null;
  targetId: string | null;
  dateOfCreation: string | null;
  requirements: Requirement[];
  rejections: RejectionEntry[];
  /** True when the contract exposes the `decisions` action link — the
   *  authoritative "a decision is accepted now" signal, present on
   *  UNDER_REVIEW only. `null` when the payload carries no `_links`. */
  decisionsLink: boolean | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseRejections(v: unknown): RejectionEntry[] {
  if (!Array.isArray(v)) return [];
  const out: RejectionEntry[] = [];
  for (const raw of v) {
    const r = asRecord(raw);
    if (!r) continue;
    const code = str(r.code);
    const message = str(r.message);
    if (code || message) out.push({ code: code ?? "", message: message ?? "" });
  }
  return out;
}

// Read one SR out of a resource body (a GET by id, or a collection entry).
// Returns null without an `id` — a row we couldn't act on anyway.
export function parseServiceRequest(body: unknown): ServiceRequestRow | null {
  const r = asRecord(body);
  if (!r) return null;
  const id = str(r.id);
  if (!id) return null;
  const target = asRecord(r.target_resource);
  const links = asRecord(r._links);
  return {
    id,
    type: str(r.type),
    status: str(r.status),
    reason: str(r.reason),
    targetType: target ? str(target.type) : null,
    targetId: target ? str(target.id) : null,
    dateOfCreation: str(r.date_of_creation),
    requirements: extractRequirements(r),
    rejections: parseRejections(r.rejections),
    decisionsLink: links ? !!asRecord(links.decisions) : null,
  };
}

// Read the SRs out of a `listServiceRequests` collection response
// (`_embedded.service_requests[]`), tolerating a root-level array.
export function extractServiceRequests(body: unknown): ServiceRequestRow[] {
  const list = findCollectionArray(body, ["service_requests"]);
  if (!list) return [];
  const out: ServiceRequestRow[] = [];
  for (const raw of list) {
    const row = parseServiceRequest(raw);
    if (row) out.push(row);
  }
  return out;
}

/** A resource of the current run: (target_resource_type, target_resource_id). */
export interface DecisionTarget {
  resourceType: string;
  resourceId: string;
}

// Keep only the SRs that provably belong to the current run: one of the ids the
// context captured, or an SR whose own `target_resource` matches a resource of
// the run. The query params sent to `listServiceRequests` are NOT trusted for
// this — a server (or a synced contract) that ignores an unknown filter answers
// with the tenant's whole page, and a decision here is terminal and
// irreversible: « Tout approuver » must never reach another subscription. An SR
// whose payload carries no target_resource is kept only if the context knows it.
export function scopeServiceRequests(
  rows: ServiceRequestRow[],
  targets: DecisionTarget[],
  contextIds: string[],
): ServiceRequestRow[] {
  const known = new Set(contextIds.filter(Boolean));
  const inRun = new Set(
    targets.map((t) => `${t.resourceType}:${t.resourceId}`),
  );
  return rows.filter(
    (row) =>
      known.has(row.id) ||
      (!!row.targetType &&
        !!row.targetId &&
        inRun.has(`${row.targetType}:${row.targetId}`)),
  );
}

// Merge SR sets (context ids + one list call per target resource of the run),
// keeping the FIRST occurrence of each id: the earlier sources are the more
// detailed ones (a GET by id over a collection entry). Order is stable —
// decidable SRs first (that's what the reviewer acts on), then by creation date.
export function mergeServiceRequests(
  ...sets: ServiceRequestRow[][]
): ServiceRequestRow[] {
  const byId = new Map<string, ServiceRequestRow>();
  for (const set of sets)
    for (const row of set) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => {
    const decidable = Number(isDecidable(b)) - Number(isDecidable(a));
    if (decidable) return decidable;
    return (a.dateOfCreation ?? "").localeCompare(b.dateOfCreation ?? "");
  });
}

// A decision is accepted only on UNDER_REVIEW, and `status` is the field the
// contract makes required — so it decides. The `decisions` action link is only
// consulted when there is no status at all (an abbreviated payload): treating a
// missing link as "not decidable" would hide the buttons on a genuinely
// UNDER_REVIEW demand if the API stopped publishing action links, and with the
// raw decide step gone the parcours could no longer be finished at all. Offering
// the button on a demand the server refuses costs one visible 409, which is what
// the old explicit form did too.
export function isDecidable(row: ServiceRequestRow): boolean {
  if (row.status) return row.status === DECIDABLE_STATUS;
  return row.decisionsLink === true;
}

/** Requirements still blocking the SR (MISSING/INVALID) — shown as a warning:
 *  such an SR normally sits in REQUIRES_INFORMATION, not UNDER_REVIEW. */
export function blockingRequirements(row: ServiceRequestRow): Requirement[] {
  return row.requirements.filter(isRequirementBlocking);
}

/** One-line French summary of an SR's requirements. */
export function summariseRequirements(row: ServiceRequestRow): string {
  const total = row.requirements.length;
  if (!total) return "Aucune exigence";
  const blocking = blockingRequirements(row).length;
  const plural = total > 1 ? "s" : "";
  if (!blocking) return `${total} exigence${plural} · toutes fournies`;
  return `${total} exigence${plural} · ${blocking} en attente`;
}

// The polymorphic decision body. A rejection needs at least one structured
// reason; an empty/blank message falls back to the code's default so the call
// can't fail the contract's minLength.
export function buildDecisionBody(
  outcome: QuickDecisionOutcome,
  rejection?: { code: string; message?: string },
): Record<string, unknown> {
  if (outcome === "APPROVED") return { outcome };
  const code = rejection?.code ?? "";
  const message = rejection?.message?.trim() || defaultRejectionMessage(code);
  return {
    outcome,
    rejection_reasons: [{ code, message }],
  };
}

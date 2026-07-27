// Pure analysis of a service request's `requirements[]` for the Parcours
// document form (components/ParcoursDocuments.tsx). Kept free of React and
// network so the branching can be unit-tested in isolation (mirrors
// lib/schema-normalize.ts).
//
// A service request exposes a flat `requirements: ServiceRequestRequirement[]`.
// Each entry has a `kind` (DOCUMENT | DATA_FIELD) and a server-managed `state`.
// A DOCUMENT requirement in MISSING/INVALID needs a document uploaded +
// attached; once no requirement is left MISSING/INVALID the SR auto-transitions
// REQUIRES_INFORMATION → UNDER_REVIEW.

import { asRecord, findCollectionArray } from "@/lib/parcours";

export type RequirementKind = "DOCUMENT" | "DATA_FIELD";
export type RequirementState =
  | "MISSING"
  | "SUBMITTED"
  | "VALIDATED"
  | "INVALID";

export interface DocumentReference {
  id?: string;
  type?: string;
}

export interface Requirement {
  kind: RequirementKind;
  state: RequirementState;
  /** DOCUMENT only: the document types that can satisfy this requirement. */
  accepted_document_types?: string[];
  /** Present once a document has been attached (SUBMITTED/VALIDATED/INVALID). */
  document?: DocumentReference;
  /** DATA_FIELD: JSON pointer to the offending field. */
  pointer?: string;
  /** Present when state === INVALID: machine-readable rejection reason. */
  error_code?: string;
}

function coerceStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length ? out : undefined;
}

// Read a single requirement entry defensively — an entry missing `kind`/`state`
// is dropped (the two are `required` in the contract, so this only guards
// against malformed payloads).
function parseRequirement(raw: unknown): Requirement | null {
  const r = asRecord(raw);
  if (!r) return null;
  const kind = r.kind;
  const state = r.state;
  if (kind !== "DOCUMENT" && kind !== "DATA_FIELD") return null;
  if (
    state !== "MISSING" &&
    state !== "SUBMITTED" &&
    state !== "VALIDATED" &&
    state !== "INVALID"
  )
    return null;
  const doc = asRecord(r.document);
  return {
    kind,
    state,
    accepted_document_types: coerceStringArray(r.accepted_document_types),
    document: doc
      ? {
          id: typeof doc.id === "string" ? doc.id : undefined,
          type: typeof doc.type === "string" ? doc.type : undefined,
        }
      : undefined,
    pointer: typeof r.pointer === "string" ? r.pointer : undefined,
    error_code: typeof r.error_code === "string" ? r.error_code : undefined,
  };
}

// Pull the `requirements[]` out of a service-request response body, tolerating
// an `_embedded` wrapper and a missing/empty array.
export function extractRequirements(srBody: unknown): Requirement[] {
  if (!asRecord(srBody)) return [];
  const list = findCollectionArray(srBody, ["requirements"]);
  if (!list) return [];
  const out: Requirement[] = [];
  for (const raw of list) {
    const req = parseRequirement(raw);
    if (req) out.push(req);
  }
  return out;
}

// Per-requirement keys for the upload form's row state (picked file, chosen
// type, chosen owner). A requirement carries no id in the contract, so the key
// is its signature — kind + accepted types + pointer — plus an occurrence index
// to keep entries with the same signature apart. Unlike a plain array index,
// this survives the reordering/shrinking of `requirements[]` that a refresh
// brings (a satisfied entry moving, a malformed one dropped), so a user's
// choices stay attached to the requirement they were made for.
export function requirementKeys(reqs: Requirement[]): string[] {
  const seen = new Map<string, number>();
  return reqs.map((r) => {
    const signature = [
      r.kind,
      (r.accepted_document_types ?? []).join("+"),
      r.pointer ?? "",
      // The attached document, once there is one, is what tells two otherwise
      // identical entries apart (two pieces of the same type).
      r.document?.id ?? "",
    ].join("|");
    const occurrence = seen.get(signature) ?? 0;
    seen.set(signature, occurrence + 1);
    return `${signature}#${occurrence}`;
  });
}

// Identity of a whole requirement set, so a caller can tell "the same
// requirements, re-read" from "the server changed them".
//
// Needed because the occurrence counter above is still position-dependent for
// entries that share a signature AND carry no document yet: if such an entry is
// dropped (satisfied, or malformed), the survivor is re-keyed `…#0` and would
// inherit the row state of the one that disappeared — the picked file, the
// chosen type/owner, even an already-created document id. Row state is therefore
// dropped whenever this key changes: the only case where a user loses a picked
// file is one where the mapping became genuinely ambiguous.
export function requirementSetKey(reqs: Requirement[]): string {
  const keys = requirementKeys(reqs);
  return reqs.map((r, i) => `${keys[i]}:${r.state}`).join(";");
}

// The current SR `status`, when present.
export function extractServiceRequestStatus(srBody: unknown): string | null {
  const root = asRecord(srBody);
  const status = root?.status;
  return typeof status === "string" ? status : null;
}

// A requirement still blocks the SR when it is MISSING or INVALID.
export function isRequirementBlocking(r: Requirement): boolean {
  return r.state === "MISSING" || r.state === "INVALID";
}

// A DOCUMENT requirement awaiting an upload (fresh or a replacement for a
// rejected one).
export function isDocRequirementPending(r: Requirement): boolean {
  return r.kind === "DOCUMENT" && isRequirementBlocking(r);
}

// True when no requirement remains MISSING/INVALID — the SR is ready to move to
// UNDER_REVIEW. An SR with no requirements at all counts as complete. Operates
// on already-parsed requirements so callers holding Requirement[] don't re-parse.
export function areRequirementsComplete(reqs: Requirement[]): boolean {
  return !reqs.some(isRequirementBlocking);
}

// Convenience over a raw service-request response body (parse, then check).
export function isServiceRequestComplete(srBody: unknown): boolean {
  return areRequirementsComplete(extractRequirements(srBody));
}

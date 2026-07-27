import { loadSpec } from "@/lib/specs";
import type { OpenApiDocument } from "@/lib/types";

// Which owner id a document may be attached to depends on its `document_type`:
// the Document API validates the type against an owner-scoped sub-enum and
// answers 422 `UNPROCESSABLE` otherwise ("Document type 'PROOF_OF_ADDRESS'
// cannot be attached to the provided owner (contract_id)").
//
// The contract expresses that mapping as three sibling schemas — one per owner
// field — each narrowing the master `DocumentType`. They are orphan schemas
// (never `$ref`'d by `DocumentCreate`, which keeps the full enum), so the
// mapping has to be read out of `components.schemas` ourselves.

export const OWNER_FIELDS = [
  "person_id",
  "contract_id",
  "payment_method_id",
] as const;

export type DocumentOwnerField = (typeof OWNER_FIELDS)[number];

/** Sub-enum schema that lists the types accepted for each owner field. */
const SUB_ENUM_BY_OWNER: Record<DocumentOwnerField, string> = {
  person_id: "PersonDocumentType",
  contract_id: "ContractDocumentType",
  payment_method_id: "PaymentMethodDocumentType",
};

/** `document_type` → owner fields it may be attached to. */
export type DocumentOwnerMap = Record<string, DocumentOwnerField[]>;

/** Owner ids available to attach a document to (empty/missing = unusable). */
export type DocumentOwnerIds = Partial<Record<DocumentOwnerField, string>>;

export interface ResolvedDocumentOwner {
  /**
   * The type as the contract spells it (canonical casing, trimmed) — this is
   * what must be sent, so the value validated here is the value posted.
   */
  type: string;
  /** Owner field to send with the multipart, or null when none is settled. */
  field: DocumentOwnerField | null;
  /** Id of that owner ("" when `field` is null). */
  id: string;
  /** Owners selectable for this type: valid *and* present in the context. */
  candidates: DocumentOwnerField[];
  /** Owners the spec accepts for the type; null when the type is unknown. */
  validOwners: DocumentOwnerField[] | null;
  /**
   * Set when the owner this service request expects — valid for the type — has
   * no id in the context. Nothing is auto-substituted then: another owner would
   * silently file the document in the wrong place.
   */
  missingPreferred: DocumentOwnerField | null;
}

/**
 * Read the type → owners mapping out of a Document API document. Returns an
 * empty map when the sub-enums are absent (older contract) — callers then keep
 * their own preference rather than inventing a mapping.
 */
export function buildDocumentOwnerMap(
  doc: OpenApiDocument | null,
): DocumentOwnerMap {
  const schemas = doc?.components?.schemas;
  const map: DocumentOwnerMap = {};
  if (!schemas) return map;
  for (const owner of OWNER_FIELDS) {
    const values = schemas[SUB_ENUM_BY_OWNER[owner]]?.enum;
    if (!Array.isArray(values)) continue;
    for (const v of values) {
      if (typeof v !== "string" || !v.trim()) continue;
      const type = v.trim();
      const owners = (map[type] ??= []);
      if (!owners.includes(owner)) owners.push(owner);
    }
  }
  return map;
}

/**
 * Mapping for the document API as currently synced. `loadSpec` is memoized and
 * invalidated by `resetSpecCache()`, so this needs no cache of its own.
 *
 * REJECTS when the mapping can't be read — spec absent (not synced, or outside
 * Tauri) or carrying no owner sub-enum. An empty map must never reach a caller
 * as a success: `resolveDocumentOwner` would then fall back to the SR's
 * preferred owner for every type, i.e. exactly the wrong-owner 422 this module
 * exists to prevent, with the UI claiming the owner was deduced from the
 * contract. Callers surface the failure (and stop uploading) instead.
 */
export async function loadDocumentOwnerMap(): Promise<DocumentOwnerMap> {
  const doc = await loadSpec("document");
  if (!doc)
    throw new Error(
      "Contrat de l'API document introuvable — synchronisez les specs.",
    );
  const map = buildDocumentOwnerMap(doc);
  if (!Object.keys(map).length)
    throw new Error(
      "Le contrat de l'API document ne déclare pas les types par propriétaire " +
        `(${Object.values(SUB_ENUM_BY_OWNER).join(", ")}) — resynchronisez les specs.`,
    );
  return map;
}

/**
 * The contract's spelling of `raw`, matched case-insensitively. Free-text types
 * are entered by hand (a requirement without `accepted_document_types`), so the
 * value looked up and the value sent must be normalised the same way — the
 * `uppercase` styling on that input is CSS only.
 */
export function canonicalDocumentType(
  ownerMap: DocumentOwnerMap,
  raw: string,
): string {
  const trimmed = raw.trim();
  if (ownerMap[trimmed]) return trimmed;
  const upper = trimmed.toUpperCase();
  for (const type of Object.keys(ownerMap)) {
    if (type.toUpperCase() === upper) return type;
  }
  // Unknown to the mapping (type newer than the synced contract): still send the
  // upper-case spelling. `DocumentType` is an upper-case enum and the free-text
  // input *looks* upper-case (CSS), so posting the raw lower-case text would be
  // rejected for a value the user never saw on screen.
  return upper;
}

/**
 * Pick the owner a document of `documentType` should be attached to.
 *
 * The service request only supplies a *preference* (its own scope); the type
 * decides. When several owners are valid the caller-supplied `override` wins,
 * else the preference, else `OWNER_FIELDS` order (person first — person-scoped
 * pieces like a RIB belong to the subscriber unless said otherwise).
 */
export function resolveDocumentOwner({
  documentType,
  ownerMap,
  preferred,
  owners,
  override,
}: {
  documentType: string;
  ownerMap: DocumentOwnerMap;
  preferred?: DocumentOwnerField;
  owners: DocumentOwnerIds;
  override?: DocumentOwnerField;
}): ResolvedDocumentOwner {
  const has = (f: DocumentOwnerField) => !!owners[f]?.trim();
  const type = canonicalDocumentType(ownerMap, documentType);
  const validOwners = ownerMap[type] ?? null;

  // Owners worth offering, preference first: valid for the type (all of them
  // when the type is unknown) and actually present in the context.
  const candidates: DocumentOwnerField[] = [];
  for (const f of [...(preferred ? [preferred] : []), ...OWNER_FIELDS]) {
    if (!has(f) || candidates.includes(f)) continue;
    if (!validOwners || validOwners.includes(f)) candidates.push(f);
  }

  const settle = (field: DocumentOwnerField | null) => ({
    type,
    field,
    id: field ? owners[field]!.trim() : "",
    candidates,
    validOwners,
    missingPreferred:
      !!preferred && !has(preferred) && !!validOwners?.includes(preferred)
        ? preferred
        : null,
  });

  if (override && candidates.includes(override)) return settle(override);

  // Unknown type (or a contract without the sub-enums): keep the preference —
  // the server stays the authority on what it accepts. Nothing is guessed, but
  // `candidates` still lets the caller offer an explicit choice.
  if (!validOwners) return settle(preferred && has(preferred) ? preferred : null);

  // The type is valid on the owner this SR expects, but that id is missing from
  // the context: refuse rather than file the document under another owner.
  if (preferred && validOwners.includes(preferred) && !has(preferred))
    return settle(null);

  return settle(candidates[0] ?? null);
}

/**
 * Why no owner is settled, in the user's terms — the 422 the API would answer
 * (or the choice still to make), said before the request leaves. Null when the
 * owner is settled. Shared by the row hint and the upload guard so both speak
 * with one voice.
 */
export function describeOwnerProblem(
  owner: ResolvedDocumentOwner,
): string | null {
  if (owner.field) return null;
  const type = owner.type || "ce type";
  const list = owner.candidates.join(", ");
  // Unknown type: say so rather than pretending to know where it belongs.
  if (!owner.validOwners)
    return owner.candidates.length
      ? `« ${type} » est absent du contrat de l'API document — choisissez le propriétaire auquel le rattacher (${list}).`
      : "Propriétaire manquant dans le contexte (person_id / contract_id / payment_method_id) — complétez-le avant de téléverser.";
  if (owner.missingPreferred)
    return `« ${type} » est attendu sur ${owner.missingPreferred} pour cette demande, mais cet id est absent du contexte : complétez-le${
      owner.candidates.length
        ? ` — ou choisissez explicitement un autre propriétaire (${list})`
        : ""
    }.`;
  if (owner.validOwners.length)
    return `Aucun propriétaire compatible dans le contexte pour « ${type} » — ce type n'est valide que pour : ${owner.validOwners.join(", ")}. Complétez le contexte du parcours.`;
  return "Propriétaire manquant dans le contexte (person_id / contract_id / payment_method_id) — complétez-le avant de téléverser.";
}

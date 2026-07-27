import { describe, expect, it, vi } from "vitest";
import {
  buildDocumentOwnerMap,
  canonicalDocumentType,
  describeOwnerProblem,
  resolveDocumentOwner,
  type DocumentOwnerIds,
} from "@/lib/document-owner";
import type { OpenApiDocument } from "@/lib/types";

// Trimmed document.yaml: the three owner-scoped sub-enums the contract uses to
// say which owner a `document_type` may be attached to. They are orphan schemas
// (DocumentCreate keeps the full enum), hence read from components.schemas.
const doc = {
  openapi: "3.1.0",
  info: { title: "Document Management API", version: "0.0.73" },
  paths: {},
  components: {
    schemas: {
      PersonDocumentType: {
        type: "string",
        enum: [
          "PROOF_OF_IDENTITY",
          "PROOF_OF_ADDRESS",
          "CERFA_3916",
          "W8BEN_FORM",
          "BANK_DETAILS",
          "OTHER",
        ],
      },
      ContractDocumentType: {
        type: "string",
        enum: [
          "MEMBERSHIP_FORM",
          "SEPA_MANDATE",
          "PROOF_OF_FUND_ORIGIN",
          "PROOF_OF_IDENTITY",
          "OTHER",
        ],
      },
      PaymentMethodDocumentType: {
        type: "string",
        enum: ["SEPA_MANDATE", "BANK_DETAILS", "FOREIGN_BANK_DETAILS", "OTHER"],
      },
    },
  },
} as unknown as OpenApiDocument;

const ownerMap = buildDocumentOwnerMap(doc);

// A parcours context after Phase A bis + B: person, payment method, contract.
const fullContext: DocumentOwnerIds = {
  person_id: "p-1",
  contract_id: "c-1",
  payment_method_id: "pm-1",
};

describe("buildDocumentOwnerMap", () => {
  it("maps each type to the owners whose sub-enum lists it", () => {
    expect(ownerMap.PROOF_OF_ADDRESS).toEqual(["person_id"]);
    expect(ownerMap.MEMBERSHIP_FORM).toEqual(["contract_id"]);
    expect(ownerMap.BANK_DETAILS).toEqual(["person_id", "payment_method_id"]);
    expect(ownerMap.SEPA_MANDATE).toEqual(["contract_id", "payment_method_id"]);
    expect(ownerMap.PROOF_OF_IDENTITY).toEqual(["person_id", "contract_id"]);
    expect(ownerMap.OTHER).toEqual([
      "person_id",
      "contract_id",
      "payment_method_id",
    ]);
    expect(ownerMap.UNKNOWN_TYPE).toBeUndefined();
  });

  it("returns an empty map without the sub-enums", () => {
    expect(buildDocumentOwnerMap(null)).toEqual({});
    expect(
      buildDocumentOwnerMap({
        openapi: "3.1.0",
        info: { title: "x", version: "1" },
        paths: {},
      } as unknown as OpenApiDocument),
    ).toEqual({});
  });
});

describe("canonicalDocumentType", () => {
  it("matches the contract's spelling regardless of case and padding", () => {
    expect(canonicalDocumentType(ownerMap, "proof_of_address")).toBe(
      "PROOF_OF_ADDRESS",
    );
    expect(canonicalDocumentType(ownerMap, "  PROOF_OF_ADDRESS ")).toBe(
      "PROOF_OF_ADDRESS",
    );
    // Unknown type (newer than the synced contract): trimmed AND upper-cased —
    // DocumentType is an upper-case enum and the free-text input only *looks*
    // upper-case (CSS), so the posted value must match what the user saw.
    expect(canonicalDocumentType(ownerMap, " what_is_this ")).toBe(
      "WHAT_IS_THIS",
    );
  });
});

describe("resolveDocumentOwner", () => {
  const resolve = (
    documentType: string,
    extra: Partial<Parameters<typeof resolveDocumentOwner>[0]> = {},
  ) =>
    resolveDocumentOwner({
      documentType,
      ownerMap,
      preferred: "contract_id",
      owners: fullContext,
      ...extra,
    });

  it("sends person-only types to person_id even on a contract SR", () => {
    for (const t of ["PROOF_OF_ADDRESS", "CERFA_3916", "W8BEN_FORM"]) {
      const r = resolve(t);
      expect(r.field).toBe("person_id");
      expect(r.id).toBe("p-1");
      expect(r.candidates).toEqual(["person_id"]);
    }
  });

  it("prefers person_id for a RIB when the SR is contract-scoped", () => {
    const r = resolve("BANK_DETAILS");
    expect(r.field).toBe("person_id");
    expect(r.candidates).toEqual(["person_id", "payment_method_id"]);
    expect(r.validOwners).toEqual(["person_id", "payment_method_id"]);
  });

  it("honours the SR preference when the type accepts it", () => {
    expect(resolve("MEMBERSHIP_FORM").field).toBe("contract_id");
    expect(resolve("PROOF_OF_FUND_ORIGIN").field).toBe("contract_id");
    // Contract-scoped SR: PROOF_OF_IDENTITY is valid on both, contract wins.
    expect(resolve("PROOF_OF_IDENTITY").field).toBe("contract_id");
    // Mandate SR: the payment method wins for a type valid on both.
    expect(
      resolve("SEPA_MANDATE", { preferred: "payment_method_id" }).field,
    ).toBe("payment_method_id");
    expect(
      resolve("BANK_DETAILS", { preferred: "payment_method_id" }).field,
    ).toBe("payment_method_id");
  });

  it("normalises the type and reports the contract's spelling", () => {
    const r = resolve("  proof_of_address ");
    expect(r.type).toBe("PROOF_OF_ADDRESS");
    expect(r.field).toBe("person_id");
    expect(r.validOwners).toEqual(["person_id"]);
  });

  it("uses an override only when it is a candidate", () => {
    expect(
      resolve("BANK_DETAILS", { override: "payment_method_id" }).field,
    ).toBe("payment_method_id");
    // contract_id is not valid for a RIB — the override is ignored.
    expect(resolve("BANK_DETAILS", { override: "contract_id" }).field).toBe(
      "person_id",
    );
  });

  it("skips owners missing from the context", () => {
    const noPerson = { contract_id: "c-1", payment_method_id: "pm-1" };
    const r = resolve("BANK_DETAILS", { owners: noPerson });
    expect(r.field).toBe("payment_method_id");
    expect(r.candidates).toEqual(["payment_method_id"]);

    const onlyContract = { contract_id: "c-1", person_id: "  " };
    const none = resolve("PROOF_OF_ADDRESS", { owners: onlyContract });
    expect(none.field).toBeNull();
    expect(none.id).toBe("");
    expect(none.candidates).toEqual([]);
    // The caller can name the owners the API would have accepted.
    expect(none.validOwners).toEqual(["person_id"]);
    expect(describeOwnerProblem(none)).toContain("person_id");
  });

  it("refuses to substitute when the SR's own owner id is missing", () => {
    // Mandate SR without payment_method_id: SEPA_MANDATE is also valid on the
    // contract, but filing it there would be silently wrong.
    const r = resolveDocumentOwner({
      documentType: "SEPA_MANDATE",
      ownerMap,
      preferred: "payment_method_id",
      owners: { contract_id: "c-1", person_id: "p-1" },
    });
    expect(r.field).toBeNull();
    expect(r.missingPreferred).toBe("payment_method_id");
    // …but the contract stays offered, so the user can decide explicitly.
    expect(r.candidates).toEqual(["contract_id"]);
    expect(
      resolveDocumentOwner({
        documentType: "SEPA_MANDATE",
        ownerMap,
        preferred: "payment_method_id",
        owners: { contract_id: "c-1" },
        override: "contract_id",
      }).field,
    ).toBe("contract_id");
    const problem = describeOwnerProblem(r);
    expect(problem).toContain("payment_method_id");
    expect(problem).toContain("contract_id");
  });

  it("keeps the SR preference for an unknown type, and still offers the rest", () => {
    const unknown = resolve("SOMETHING_ELSE");
    expect(unknown.field).toBe("contract_id");
    expect(unknown.validOwners).toBeNull();
    // Every owner in the context is selectable — nothing about the type is known.
    expect(unknown.candidates).toEqual([
      "contract_id",
      "person_id",
      "payment_method_id",
    ]);

    const noSpec = resolveDocumentOwner({
      documentType: "PROOF_OF_ADDRESS",
      ownerMap: {},
      preferred: "contract_id",
      owners: fullContext,
    });
    expect(noSpec.field).toBe("contract_id");
    expect(noSpec.validOwners).toBeNull();

    // Preferred owner absent: nothing is guessed, but the choice is offered.
    const noPreferredId = resolve("SOMETHING_ELSE", {
      owners: { person_id: "p-1" },
    });
    expect(noPreferredId.field).toBeNull();
    expect(noPreferredId.candidates).toEqual(["person_id"]);
    expect(describeOwnerProblem(noPreferredId)).toContain("person_id");
  });
});

describe("describeOwnerProblem", () => {
  it("says nothing when the owner is settled", () => {
    expect(
      describeOwnerProblem(
        resolveDocumentOwner({
          documentType: "MEMBERSHIP_FORM",
          ownerMap,
          preferred: "contract_id",
          owners: fullContext,
        }),
      ),
    ).toBeNull();
  });

  it("names the context fields to fill when nothing is available", () => {
    const problem = describeOwnerProblem(
      resolveDocumentOwner({
        documentType: "PROOF_OF_ADDRESS",
        ownerMap,
        preferred: "contract_id",
        owners: {},
      }),
    );
    expect(problem).toContain("person_id");
  });
});

// An owner map that can't be read must REJECT, never resolve empty: an empty map
// makes resolveDocumentOwner fall back to the SR's preferred owner for every
// type — the wrong-owner 422 this module exists to prevent, with the UI claiming
// the owner was deduced from the contract.
describe("loadDocumentOwnerMap", () => {
  it("rejects when the document contract carries no owner sub-enum", async () => {
    vi.resetModules();
    vi.doMock("@/lib/specs", () => ({
      loadSpec: async () => ({
        openapi: "3.1.0",
        info: { title: "Document", version: "1" },
        paths: {},
        components: { schemas: { DocumentType: { enum: ["ID_CARD"] } } },
      }),
    }));
    const mod = await import("@/lib/document-owner");
    await expect(mod.loadDocumentOwnerMap()).rejects.toThrow(/propriétaire/i);
  });

  it("rejects when the document contract is not synced", async () => {
    vi.resetModules();
    vi.doMock("@/lib/specs", () => ({ loadSpec: async () => null }));
    const mod = await import("@/lib/document-owner");
    await expect(mod.loadDocumentOwnerMap()).rejects.toThrow(/introuvable/i);
  });

  it("returns the mapping when the sub-enums are there", async () => {
    vi.resetModules();
    vi.doMock("@/lib/specs", () => ({ loadSpec: async () => doc }));
    const mod = await import("@/lib/document-owner");
    await expect(mod.loadDocumentOwnerMap()).resolves.toEqual(
      buildDocumentOwnerMap(doc),
    );
  });
});

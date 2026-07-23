import { describe, expect, it } from "vitest";
import {
  areRequirementsComplete,
  extractRequirements,
  extractServiceRequestStatus,
  isDocRequirementPending,
  isRequirementBlocking,
  isServiceRequestComplete,
} from "@/lib/parcours-documents";

// The user's example: a CONTRACT_SUBSCRIPTION with 11 document requirements,
// all already attached (state SUBMITTED). Trimmed to a few entries; the shape
// is what matters.
const submittedSr = {
  type: "CONTRACT_SUBSCRIPTION",
  status: "UNDER_REVIEW",
  id: "70e24e70-184b-420c-91f0-789a2fe4bae2",
  requirements: [
    {
      accepted_document_types: ["MEMBERSHIP_FORM"],
      document: { id: "3fecaba6", type: "MEMBERSHIP_FORM" },
      kind: "DOCUMENT",
      state: "SUBMITTED",
    },
    {
      accepted_document_types: ["PROOF_OF_IDENTITY", "BIRTH_CERTIFICATE"],
      document: { id: "44d2f862", type: "PROOF_OF_IDENTITY" },
      kind: "DOCUMENT",
      state: "SUBMITTED",
    },
    {
      accepted_document_types: ["BANK_DETAILS"],
      document: { id: "ae1a6062", type: "BANK_DETAILS" },
      kind: "DOCUMENT",
      state: "SUBMITTED",
    },
  ],
};

const freshSr = {
  status: "REQUIRES_INFORMATION",
  requirements: [
    { accepted_document_types: ["MEMBERSHIP_FORM"], kind: "DOCUMENT", state: "MISSING" },
    {
      accepted_document_types: ["PROOF_OF_IDENTITY", "BIRTH_CERTIFICATE"],
      document: { id: "old-doc", type: "PROOF_OF_IDENTITY" },
      kind: "DOCUMENT",
      state: "INVALID",
      error_code: "INADEQUATE_DOCUMENT",
    },
    { kind: "DATA_FIELD", state: "MISSING", pointer: "/address/postal_code" },
    { accepted_document_types: ["BANK_DETAILS"], kind: "DOCUMENT", state: "VALIDATED" },
  ],
};

describe("extractRequirements", () => {
  it("reads the flat requirements array", () => {
    expect(extractRequirements(submittedSr)).toHaveLength(3);
  });

  it("tolerates an _embedded wrapper", () => {
    const wrapped = { _embedded: { requirements: submittedSr.requirements } };
    expect(extractRequirements(wrapped)).toHaveLength(3);
  });

  it("returns [] for missing / non-object / empty bodies", () => {
    expect(extractRequirements(null)).toEqual([]);
    expect(extractRequirements({})).toEqual([]);
    expect(extractRequirements({ requirements: [] })).toEqual([]);
    expect(extractRequirements("nope")).toEqual([]);
  });

  it("drops malformed entries (missing kind/state)", () => {
    const body = {
      requirements: [
        { kind: "DOCUMENT", state: "MISSING" },
        { kind: "WRONG", state: "MISSING" },
        { foo: "bar" },
        null,
      ],
    };
    expect(extractRequirements(body)).toHaveLength(1);
  });

  it("normalizes accepted_document_types and document", () => {
    const [first] = extractRequirements(submittedSr);
    expect(first.accepted_document_types).toEqual(["MEMBERSHIP_FORM"]);
    expect(first.document).toEqual({ id: "3fecaba6", type: "MEMBERSHIP_FORM" });
  });
});

describe("extractServiceRequestStatus", () => {
  it("reads the status field", () => {
    expect(extractServiceRequestStatus(submittedSr)).toBe("UNDER_REVIEW");
    expect(extractServiceRequestStatus(freshSr)).toBe("REQUIRES_INFORMATION");
    expect(extractServiceRequestStatus({})).toBeNull();
  });
});

describe("isRequirementBlocking / isDocRequirementPending", () => {
  it("MISSING and INVALID block; SUBMITTED and VALIDATED do not", () => {
    const reqs = extractRequirements(freshSr);
    const [missingDoc, invalidDoc, dataField, validatedDoc] = reqs;
    expect(isRequirementBlocking(missingDoc)).toBe(true);
    expect(isRequirementBlocking(invalidDoc)).toBe(true);
    expect(isRequirementBlocking(dataField)).toBe(true);
    expect(isRequirementBlocking(validatedDoc)).toBe(false);
  });

  it("only DOCUMENT + MISSING/INVALID is a pending upload row", () => {
    const reqs = extractRequirements(freshSr);
    const [missingDoc, invalidDoc, dataField, validatedDoc] = reqs;
    expect(isDocRequirementPending(missingDoc)).toBe(true);
    expect(isDocRequirementPending(invalidDoc)).toBe(true); // replaceable
    expect(isDocRequirementPending(dataField)).toBe(false); // not a document
    expect(isDocRequirementPending(validatedDoc)).toBe(false);
  });
});

describe("isServiceRequestComplete", () => {
  it("is true when every requirement is SUBMITTED/VALIDATED", () => {
    expect(isServiceRequestComplete(submittedSr)).toBe(true);
  });

  it("is false while any requirement is MISSING/INVALID", () => {
    expect(isServiceRequestComplete(freshSr)).toBe(false);
  });

  it("is true for an SR with no requirements", () => {
    expect(isServiceRequestComplete({ requirements: [] })).toBe(true);
    expect(isServiceRequestComplete({})).toBe(true);
  });
});

describe("areRequirementsComplete", () => {
  it("operates on already-parsed requirements without re-parsing", () => {
    expect(areRequirementsComplete(extractRequirements(submittedSr))).toBe(true);
    expect(areRequirementsComplete(extractRequirements(freshSr))).toBe(false);
    expect(areRequirementsComplete([])).toBe(true);
  });
});

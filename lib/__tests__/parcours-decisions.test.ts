import { describe, expect, it } from "vitest";
import {
  blockingRequirements,
  buildDecisionBody,
  CONTEXT_SR_KEYS,
  CONTEXT_SR_TYPES,
  contextKeyForSrType,
  DECIDABLE_STATUS,
  defaultRejectionMessage,
  extractServiceRequests,
  isDecidable,
  mergeServiceRequests,
  parseServiceRequest,
  REJECTION_REASONS,
  scopeServiceRequests,
  srTypeLabel,
  summariseRequirements,
  type ServiceRequestRow,
} from "@/lib/parcours-decisions";
import { SOUSCRIPTION_PARCOURS } from "@/lib/parcours";

// A reviewer-facing SR as the service-request contract shapes it.
function srBody(over: Record<string, unknown> = {}) {
  return {
    id: "sr-1",
    type: "CONTRACT_SUBSCRIPTION",
    status: "UNDER_REVIEW",
    reason: "Revue de la souscription.",
    target_resource: {
      type: "CONTRACT",
      id: "c-1",
      href: "/contracts/c-1",
    },
    requirements: [
      {
        kind: "DOCUMENT",
        state: "VALIDATED",
        accepted_document_types: ["PROOF_OF_ADDRESS"],
      },
    ],
    rejections: [],
    date_of_creation: "2026-04-23T10:15:30Z",
    _links: {
      self: { href: "/service-requests/sr-1", method: "GET" },
      decisions: { href: "/service-requests/sr-1/decisions", method: "POST" },
    },
    ...over,
  };
}

describe("parseServiceRequest", () => {
  it("reads id, type, status, target resource, requirements and the decisions link", () => {
    const row = parseServiceRequest(srBody());
    expect(row).toMatchObject({
      id: "sr-1",
      type: "CONTRACT_SUBSCRIPTION",
      status: "UNDER_REVIEW",
      targetType: "CONTRACT",
      targetId: "c-1",
      dateOfCreation: "2026-04-23T10:15:30Z",
      decisionsLink: true,
    });
    expect(row?.requirements).toHaveLength(1);
    expect(row?.rejections).toEqual([]);
  });

  it("reads the structured rejections of a REJECTED demand", () => {
    const row = parseServiceRequest(
      srBody({
        status: "REJECTED",
        rejections: [
          { code: "UNREADABLE_DOCUMENT", message: "Pièce illisible." },
          { nonsense: true },
        ],
        _links: { self: { href: "/service-requests/sr-1", method: "GET" } },
      }),
    );
    expect(row?.rejections).toEqual([
      { code: "UNREADABLE_DOCUMENT", message: "Pièce illisible." },
    ]);
    // No `decisions` action link on a resolved SR.
    expect(row?.decisionsLink).toBe(false);
  });

  it("drops a payload with no id (nothing could be decided on it)", () => {
    expect(parseServiceRequest({ status: "UNDER_REVIEW" })).toBeNull();
    expect(parseServiceRequest(null)).toBeNull();
  });
});

describe("extractServiceRequests", () => {
  it("reads the HAL collection's _embedded.service_requests", () => {
    const rows = extractServiceRequests({
      _embedded: { service_requests: [srBody(), srBody({ id: "sr-2" })] },
      page: { size: 20, total_elements: 2 },
    });
    expect(rows.map((r) => r.id)).toEqual(["sr-1", "sr-2"]);
  });

  it("returns [] on an unexpected shape", () => {
    expect(extractServiceRequests({})).toEqual([]);
    expect(extractServiceRequests(null)).toEqual([]);
  });
});

describe("isDecidable", () => {
  const row = (over: Partial<ServiceRequestRow>): ServiceRequestRow => ({
    id: "sr-1",
    type: "CONTRACT_SUBSCRIPTION",
    status: "UNDER_REVIEW",
    reason: null,
    targetType: null,
    targetId: null,
    dateOfCreation: null,
    requirements: [],
    rejections: [],
    decisionsLink: null,
    ...over,
  });

  it("goes by the status, which the contract makes required", () => {
    expect(isDecidable(row({ status: DECIDABLE_STATUS }))).toBe(true);
    expect(isDecidable(row({ status: "REQUIRES_INFORMATION" }))).toBe(false);
    expect(isDecidable(row({ status: "APPROVED" }))).toBe(false);
  });

  it("stays decidable on UNDER_REVIEW even when the API publishes no decisions link", () => {
    // Otherwise an API that stopped exposing action links would hide every
    // button — and with the raw decide step gone, no demand could be instructed.
    expect(
      isDecidable(row({ status: "UNDER_REVIEW", decisionsLink: false })),
    ).toBe(true);
  });

  it("falls back to the action link only when the payload carries no status", () => {
    expect(isDecidable(row({ status: null, decisionsLink: true }))).toBe(true);
    expect(isDecidable(row({ status: null, decisionsLink: false }))).toBe(false);
    expect(isDecidable(row({ status: null, decisionsLink: null }))).toBe(false);
  });
});

// The query filter sent to listServiceRequests is not trusted: a decision is
// terminal, so a server that ignores an unknown filter must not turn « Tout
// approuver » into a tenant-wide approval.
describe("scopeServiceRequests", () => {
  const targets = [{ resourceType: "CONTRACT", resourceId: "c-1" }];

  it("keeps the demands of the run's own resources", () => {
    const mine = parseServiceRequest(srBody())!;
    expect(scopeServiceRequests([mine], targets, [])).toEqual([mine]);
  });

  it("drops a demand targeting another resource, even when the API returned it", () => {
    const other = parseServiceRequest(
      srBody({ id: "sr-9", target_resource: { type: "CONTRACT", id: "c-999" } }),
    )!;
    const another = parseServiceRequest(
      srBody({ id: "sr-8", target_resource: { type: "INDIVIDUAL", id: "c-1" } }),
    )!;
    expect(scopeServiceRequests([other, another], targets, [])).toEqual([]);
  });

  it("keeps a demand the context captured, whatever its target", () => {
    const captured = parseServiceRequest(
      srBody({ id: "sr-ctx", target_resource: undefined }),
    )!;
    expect(scopeServiceRequests([captured], targets, ["sr-ctx"])).toEqual([
      captured,
    ]);
    // …and drops it when the context doesn't know it and it has no target.
    expect(scopeServiceRequests([captured], targets, [])).toEqual([]);
  });
});

describe("contextKeyForSrType", () => {
  it("maps an SR type back to the context key holding its id", () => {
    expect(contextKeyForSrType("CONTRACT_SUBSCRIPTION")).toBe("sr_contract_id");
    expect(contextKeyForSrType("SEPA_MANDATE_SIGNATURE")).toBe("sr_mandate_id");
    expect(contextKeyForSrType("BENEFICIARY_CLAUSE_CHANGE")).toBe(
      "sr_beneficiary_id",
    );
  });

  it("has no key for a type the parcours doesn't track", () => {
    expect(contextKeyForSrType("ADDRESS_CHANGE")).toBeNull();
    expect(contextKeyForSrType(null)).toBeNull();
  });

  it("covers every key CONTEXT_SR_TYPES declares (round-trip)", () => {
    for (const key of CONTEXT_SR_KEYS)
      expect(contextKeyForSrType(CONTEXT_SR_TYPES[key])).toBe(key);
  });
});

describe("mergeServiceRequests", () => {
  it("keeps the first occurrence of an id and puts decidable demands first", () => {
    const detailed = parseServiceRequest(srBody({ id: "sr-1" }))!;
    const listedDuplicate = parseServiceRequest(
      srBody({ id: "sr-1", reason: "from the list" }),
    )!;
    const resolved = parseServiceRequest(
      srBody({
        id: "sr-0",
        status: "APPROVED",
        date_of_creation: "2026-01-01T00:00:00Z",
        _links: { self: { href: "/service-requests/sr-0", method: "GET" } },
      }),
    )!;
    const merged = mergeServiceRequests([detailed], [resolved, listedDuplicate]);
    expect(merged.map((r) => r.id)).toEqual(["sr-1", "sr-0"]);
    // The detailed (fetched-by-id) row won, not the list entry.
    expect(merged[0].reason).toBe("Revue de la souscription.");
  });
});

describe("summariseRequirements / blockingRequirements", () => {
  const rowOf = (reqs: unknown[]) =>
    parseServiceRequest(srBody({ requirements: reqs }))!;

  it("counts the requirements still blocking", () => {
    const row = rowOf([
      { kind: "DOCUMENT", state: "VALIDATED" },
      { kind: "DOCUMENT", state: "MISSING" },
      { kind: "DATA_FIELD", state: "INVALID", pointer: "/iban" },
    ]);
    expect(blockingRequirements(row)).toHaveLength(2);
    expect(summariseRequirements(row)).toBe("3 exigences · 2 en attente");
  });

  it("reports a complete set and an empty one", () => {
    expect(summariseRequirements(rowOf([{ kind: "DOCUMENT", state: "SUBMITTED" }]))).toBe(
      "1 exigence · toutes fournies",
    );
    expect(summariseRequirements(rowOf([]))).toBe("Aucune exigence");
  });
});

describe("buildDecisionBody", () => {
  it("approves with the outcome alone", () => {
    expect(buildDecisionBody("APPROVED")).toEqual({ outcome: "APPROVED" });
  });

  it("rejects with one structured reason", () => {
    expect(
      buildDecisionBody("REJECTED", {
        code: "EXPIRED_DOCUMENT",
        message: "Justificatif de domicile de plus de 3 mois.",
      }),
    ).toEqual({
      outcome: "REJECTED",
      rejection_reasons: [
        {
          code: "EXPIRED_DOCUMENT",
          message: "Justificatif de domicile de plus de 3 mois.",
        },
      ],
    });
  });

  it("falls back to the code's default message (the contract requires a non-empty one)", () => {
    expect(
      buildDecisionBody("REJECTED", { code: "UNREADABLE_DOCUMENT", message: "  " }),
    ).toEqual({
      outcome: "REJECTED",
      rejection_reasons: [
        {
          code: "UNREADABLE_DOCUMENT",
          message: defaultRejectionMessage("UNREADABLE_DOCUMENT"),
        },
      ],
    });
    expect(defaultRejectionMessage("UNREADABLE_DOCUMENT")).not.toBe("");
  });
});

describe("labels", () => {
  it("names every SR type the parcours can open", () => {
    for (const type of Object.values(CONTEXT_SR_TYPES))
      expect(srTypeLabel(type)).not.toBe(type);
    expect(srTypeLabel("UNKNOWN_TYPE")).toBe("UNKNOWN_TYPE");
    expect(srTypeLabel(null)).toBe("Demande");
  });

  it("offers every rejection code of the contract with a default message", () => {
    expect(REJECTION_REASONS.map((r) => r.code)).toEqual([
      "INADEQUATE_DOCUMENT",
      "UNREADABLE_DOCUMENT",
      "EXPIRED_DOCUMENT",
      "MISSING_INFORMATION",
      "INCONSISTENT_DATA",
    ]);
    for (const r of REJECTION_REASONS) expect(r.message.length).toBeGreaterThan(0);
  });
});

describe("Phase D wiring", () => {
  it("instructs the demands through the custom decision view, not the list/decide steps", () => {
    const ids = SOUSCRIPTION_PARCOURS.steps.map((s) => s.id);
    expect(ids).toContain("review-service-requests");
    expect(ids).not.toContain("list-under-review");
    expect(ids).not.toContain("get-service-request");
    expect(ids).not.toContain("decide-service-request");
    const step = SOUSCRIPTION_PARCOURS.steps.find(
      (s) => s.id === "review-service-requests",
    );
    expect(step).toMatchObject({
      custom: "decisions",
      apiId: "service-request",
      operationId: "decideServiceRequest",
      actor: "Backoffice",
    });
    // The follow-up steps still close the parcours.
    expect(ids.slice(-2)).toEqual(["poll-contract", "poll-person"]);
  });
});

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";

import { Card, CardHeader, CardBody } from "@/components/Card";
import Field from "@/components/Field";
import StatusBadge from "@/components/StatusBadge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { callOperation } from "@/lib/operation-fetch";
import { buildMultipart } from "@/lib/multipart";
import { isSuccess } from "@/lib/parcours";
import { SPECS_CHANGED_EVENT } from "@/lib/specs";
import {
  describeOwnerProblem,
  loadDocumentOwnerMap,
  resolveDocumentOwner,
  type DocumentOwnerField,
  type DocumentOwnerIds,
  type DocumentOwnerMap,
  type ResolvedDocumentOwner,
} from "@/lib/document-owner";
import {
  extractRequirements,
  extractServiceRequestStatus,
  isDocRequirementPending,
  areRequirementsComplete,
  requirementKeys,
  requirementSetKey,
  type Requirement,
} from "@/lib/parcours-documents";
import { srStatusTone, type StatusTone } from "@/lib/design";
import { apiErrorMessage } from "@/lib/http";
import { cn, formatFileSize } from "@/lib/utils";

// One service request the form should complete. Built by the Parcours page from
// the shared context (contract / SEPA mandate / beneficiary clause SRs). The
// document owner is *not* fixed by the SR: it is resolved per document type,
// the SR only saying which owner it would prefer when several are valid.
export interface ParcoursSrTarget {
  /** Context key of the SR id — used as a stable React key. */
  key: string;
  /** service_request_id. */
  id: string;
  /** Human label shown on the card header. */
  label: string;
  /** Owner to favour when the document type accepts several. */
  preferredOwner: DocumentOwnerField;
  /** Owner ids available in the parcours context (empty ones dropped). */
  owners: DocumentOwnerIds;
}

interface Props {
  serviceRequests: ParcoursSrTarget[];
  /** Called (via an explicit button) once every SR's requirements are satisfied,
   *  so the host advances the parcours to Phase D. */
  onComplete: () => void;
}

interface SrDetail {
  loading: boolean;
  error: string | null;
  status: string | null;
  requirements: Requirement[];
}

const EMPTY_DETAIL: SrDetail = {
  loading: true,
  error: null,
  status: null,
  requirements: [],
};

function reqTone(state: Requirement["state"]): StatusTone {
  switch (state) {
    case "VALIDATED":
      return "success";
    case "SUBMITTED":
      return "info";
    case "INVALID":
      return "danger";
    default:
      return "warn"; // MISSING
  }
}

// (Status tone → lib/design `srStatusTone`; error message → lib/http
//  `apiErrorMessage`. Both are shared with the Phase D decision view so the same
//  demand never reads in two colours, nor an error in two wordings.)

// The type a row will send: the user's pick, or the only accepted type when the
// requirement leaves no choice. Computed once per row and threaded down, so the
// owner hint, the disabled state and the upload all agree.
function effectiveType(req: Requirement, picked: string | undefined): string {
  const accepted = req.accepted_document_types ?? [];
  return picked || (accepted.length === 1 ? accepted[0] : "");
}

function readDocumentId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const r = body as Record<string, unknown>;
  // Prefer `id` (the DocumentResource field); fall back to `document_id` for
  // resilience against a differently-named id field.
  for (const key of ["id", "document_id"]) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

// A document already created for a row, with what it was created from. Reused
// only when the row still asks for exactly that — a retry after a failed attach
// re-attaches instead of minting a duplicate, while a changed file/type/owner
// creates the document the row now describes.
interface CreatedDoc {
  id: string;
  type: string;
  ownerField: DocumentOwnerField;
  ownerId: string;
  fileKey: string;
}

// Identity of a picked file, good enough to tell "same file" from "another one".
function fileKeyOf(f: File): string {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

/** Reading of the document contract's owner mapping. */
type OwnerMapStatus = "loading" | "ready" | "error";

export default function ParcoursDocuments({
  serviceRequests,
  onComplete,
}: Props) {
  const [details, setDetails] = useState<Record<string, SrDetail>>({});
  // Per upload-row (`${srId}#${requirementKey}`) transient state.
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [types, setTypes] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});
  // Document created for a row but not yet attached (see CreatedDoc).
  const [createdDoc, setCreatedDoc] = useState<Record<string, CreatedDoc>>({});
  // (Whether the service-request / document contracts are synced is checked by
  //  the page, from the step's `requiresApis` — it gates this whole view.)
  // Per-SR requirement-set identity of the last render, so row state tied to a
  // requirement that changed identity is dropped instead of inherited.
  const reqSetRef = useRef<Record<string, string>>({});
  // Per-row owner override, used when a type accepts several owners that are
  // both in the context (a RIB: person or payment method).
  const [ownerOverride, setOwnerOverride] = useState<
    Record<string, DocumentOwnerField>
  >({});
  // document_type → owner fields it may be attached to, read from the contract.
  const [ownerMap, setOwnerMap] = useState<DocumentOwnerMap>({});
  const [ownerMapStatus, setOwnerMapStatus] =
    useState<OwnerMapStatus>("loading");

  // Drop every row state of an SR (picked file, chosen type/owner, created doc,
  // error). Called when the server's requirement set changed identity: row keys
  // disambiguate same-signature entries by position, so a dropped entry re-keys
  // its neighbour — the surviving row would inherit a file, type or already-
  // created document id chosen for a DIFFERENT requirement, and re-attach the
  // wrong piece. Losing a pending pick is the safe side of that trade.
  const resetSrRows = useCallback((srId: string) => {
    const belongsToSr = (rowKey: string) => rowKey.startsWith(`${srId}#`);
    const prune = <T,>(prev: Record<string, T>) => {
      const next: Record<string, T> = {};
      for (const [k, v] of Object.entries(prev)) if (!belongsToSr(k)) next[k] = v;
      return next;
    };
    setFiles(prune);
    setTypes(prune);
    setOwnerOverride(prune);
    setCreatedDoc(prune);
    setRowError(prune);
  }, []);

  const fetchSr = useCallback(
    async (srId: string) => {
      setDetails((prev) => ({
        ...prev,
        [srId]: { ...(prev[srId] ?? EMPTY_DETAIL), loading: true, error: null },
      }));
      const res = await callOperation({
        apiId: "service-request",
        operationId: "getServiceRequestById",
        pathParams: { service_request_id: srId },
      });
      if (res && isSuccess(res)) {
        const requirements = extractRequirements(res.body);
        const setKey = requirementSetKey(requirements);
        const previous = reqSetRef.current[srId];
        reqSetRef.current[srId] = setKey;
        if (previous !== undefined && previous !== setKey) resetSrRows(srId);
        setDetails((prev) => ({
          ...prev,
          [srId]: {
            loading: false,
            error: null,
            status: extractServiceRequestStatus(res.body),
            requirements,
          },
        }));
        return;
      }
      setDetails((prev) => ({
        ...prev,
        [srId]: {
          loading: false,
          error: apiErrorMessage(res),
          status: null,
          requirements: [],
        },
      }));
    },
    [resetSrRows],
  );

  // Load (and reload) each SR when the target list changes.
  const srIds = serviceRequests.map((s) => s.id).join("|");
  useEffect(() => {
    for (const s of serviceRequests) void fetchSr(s.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srIds, fetchSr]);


  // The document API's owner-scoped type sub-enums decide which id a document
  // may be attached to, so the mapping is a prerequisite of any upload — not a
  // nice-to-have: without it every row would fall back to the SR's own scope,
  // which is exactly the wrong-owner 422 this form exists to avoid. Hence the
  // explicit status (uploads wait for it, a failure is shown) and the re-read on
  // SPECS_CHANGED_EVENT, so a sync while the page is open is picked up.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setOwnerMapStatus((s) => (s === "ready" ? s : "loading"));
      void loadDocumentOwnerMap().then(
        (map) => {
          if (cancelled) return;
          setOwnerMap(map);
          setOwnerMapStatus("ready");
        },
        () => {
          if (!cancelled) setOwnerMapStatus("error");
        },
      );
    };
    load();
    window.addEventListener(SPECS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SPECS_CHANGED_EVENT, load);
    };
  }, []);

  const clearRowError = useCallback((rowKey: string) => {
    setRowError((p) => ({ ...p, [rowKey]: null }));
  }, []);

  // Owner a document of `documentType` must hang off. The type decides (the
  // API validates it against an owner-scoped sub-enum and answers 422
  // otherwise); the SR only supplies a preference, and the user can resolve an
  // ambiguity from the row.
  const resolveOwner = useCallback(
    (sr: ParcoursSrTarget, documentType: string, rowKey: string) =>
      resolveDocumentOwner({
        documentType,
        ownerMap,
        preferred: sr.preferredOwner,
        owners: sr.owners,
        override: ownerOverride[rowKey],
      }),
    [ownerMap, ownerOverride],
  );

  const upload = useCallback(
    async (sr: ParcoursSrTarget, req: Requirement, rowKey: string) => {
      const file = files[rowKey] ?? null;
      const accepted = req.accepted_document_types ?? [];
      const rawType =
        types[rowKey] || (accepted.length === 1 ? accepted[0] : "");
      if (!rawType) {
        setRowError((p) => ({
          ...p,
          [rowKey]: "Choisissez un type de document.",
        }));
        return;
      }
      if (ownerMapStatus !== "ready") {
        setRowError((p) => ({
          ...p,
          [rowKey]:
            ownerMapStatus === "loading"
              ? "Lecture du contrat de l'API document en cours — réessayez dans un instant."
              : "Contrat de l'API document illisible : impossible de déterminer le propriétaire du document. Synchronisez les specs.",
        }));
        return;
      }
      const owner = resolveOwner(sr, rawType, rowKey);
      // Send the contract's spelling of the type, i.e. the one just validated.
      const type = owner.type;
      if (!owner.field) {
        setRowError((p) => ({
          ...p,
          [rowKey]: describeOwnerProblem(owner) ?? "Propriétaire indéterminé.",
        }));
        return;
      }
      if (!file) {
        setRowError((p) => ({ ...p, [rowKey]: "Choisissez un fichier." }));
        return;
      }
      setUploading((p) => ({ ...p, [rowKey]: true }));
      setRowError((p) => ({ ...p, [rowKey]: null }));
      try {
        // 1) Create the document (multipart) on the resolved owner — unless a
        // prior attempt already created exactly this document (same file, type
        // and owner) and only failed to attach it, in which case reuse its id so
        // the retry re-attaches instead of minting a duplicate.
        const fileKey = fileKeyOf(file);
        const prior = createdDoc[rowKey];
        let documentId: string | null =
          prior &&
          prior.type === type &&
          prior.ownerField === owner.field &&
          prior.ownerId === owner.id &&
          prior.fileKey === fileKey
            ? prior.id
            : null;
        if (!documentId) {
          const multipart = await buildMultipart(
            { document_type: type, [owner.field]: owner.id },
            { file },
          );
          const created = await callOperation({
            apiId: "document",
            operationId: "createDocument",
            multipart,
          });
          if (!created || !isSuccess(created)) {
            setRowError((p) => ({ ...p, [rowKey]: apiErrorMessage(created) }));
            return;
          }
          documentId = readDocumentId(created.body);
          if (!documentId) {
            setRowError((p) => ({
              ...p,
              [rowKey]: "Document créé mais la réponse n'expose pas d'id.",
            }));
            return;
          }
          const entry: CreatedDoc = {
            id: documentId,
            type,
            ownerField: owner.field,
            ownerId: owner.id,
            fileKey,
          };
          setCreatedDoc((p) => ({ ...p, [rowKey]: entry }));
        }
        // 2) Attach it to the service request (matches the requirement on type).
        const attached = await callOperation({
          apiId: "service-request",
          operationId: "attachServiceRequestDocument",
          pathParams: { service_request_id: sr.id },
          body: { document_id: documentId, type },
        });
        if (!attached || !isSuccess(attached)) {
          setRowError((p) => ({ ...p, [rowKey]: apiErrorMessage(attached) }));
          return;
        }
        // Success — drop the picked file + remembered doc id, and refresh the SR
        // to reflect the new requirement state (and a possible UNDER_REVIEW).
        setFiles((p) => ({ ...p, [rowKey]: null }));
        setCreatedDoc((p) => {
          const next = { ...p };
          delete next[rowKey];
          return next;
        });
        await fetchSr(sr.id);
      } catch (e) {
        setRowError((p) => ({ ...p, [rowKey]: (e as Error).message }));
      } finally {
        setUploading((p) => ({ ...p, [rowKey]: false }));
      }
    },
    [files, types, createdDoc, fetchSr, ownerMapStatus, resolveOwner],
  );

  const allLoaded =
    serviceRequests.length > 0 &&
    serviceRequests.every((s) => details[s.id] && !details[s.id].loading);
  const anyError = serviceRequests.some((s) => details[s.id]?.error);
  const allComplete =
    serviceRequests.length === 0 ||
    (allLoaded &&
      !anyError &&
      serviceRequests.every((s) =>
        areRequirementsComplete(details[s.id]?.requirements ?? []),
      ));

  if (serviceRequests.length === 0) {
    return (
      <Card tone="info">
        <CardBody className="space-y-3 p-4 text-sm">
          <p className="text-muted-foreground">
            Aucune demande à compléter dans le contexte. Soumettez d&apos;abord
            le contrat (et, le cas échéant, créez le moyen de paiement) pour
            ouvrir les demandes de pièces justificatives.
          </p>
          <Button variant="outline" size="sm" onClick={onComplete}>
            Continuer vers l&apos;instruction (Phase D)
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* (The "contracts not synced" prompt lives on the page, driven by the
          step's `requiresApis` — it gates this view entirely.) */}
      {allComplete && (
        <Card tone="success">
          <CardBody className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="min-w-0 flex-1">
              Toutes les pièces requises sont fournies — les demandes passent en{" "}
              <code className="font-mono">UNDER_REVIEW</code>.
            </span>
            <Button variant="success" size="sm" onClick={onComplete}>
              Continuer vers l&apos;instruction (Phase D)
            </Button>
          </CardBody>
        </Card>
      )}

      {serviceRequests.map((sr) => {
        const detail = details[sr.id] ?? EMPTY_DETAIL;
        const complete =
          !detail.loading &&
          !detail.error &&
          areRequirementsComplete(detail.requirements);
        // Row state is keyed by requirement identity, not array position, so a
        // refresh that reorders or shortens `requirements[]` can't move a user's
        // file/type/owner choice onto a different requirement.
        const reqKeys = requirementKeys(detail.requirements);
        return (
          <Card key={sr.key} tone="info">
            <CardHeader tone="info">
              <span className="font-semibold">{sr.label}</span>
              {detail.status && (
                <StatusBadge
                  label={detail.status}
                  tone={srStatusTone(detail.status)}
                  className="ml-2"
                />
              )}
              <code className="text-muted-foreground ml-2 truncate font-mono text-[11px]">
                {sr.id}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={() => void fetchSr(sr.id)}
                disabled={detail.loading}
                title="Rafraîchir la demande"
              >
                <RefreshCw
                  className={cn("size-3.5", detail.loading && "animate-spin")}
                />
                Rafraîchir
              </Button>
            </CardHeader>
            <CardBody className="space-y-3 p-3">
              {detail.loading && !detail.requirements.length ? (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-3.5 animate-spin" /> Analyse des
                  exigences…
                </p>
              ) : detail.error ? (
                <p className="text-destructive text-sm">{detail.error}</p>
              ) : detail.requirements.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Aucune exigence — rien à fournir pour cette demande.
                </p>
              ) : (
                <ul className="space-y-2">
                  {detail.requirements.map((req, index) => {
                    const rowKey = `${sr.id}#${reqKeys[index]}`;
                    const rowType = effectiveType(req, types[rowKey]);
                    return (
                      <li key={rowKey}>
                        <RequirementRow
                          req={req}
                          file={files[rowKey] ?? null}
                          selectedType={types[rowKey] ?? ""}
                          effectiveType={rowType}
                          owner={resolveOwner(sr, rowType, rowKey)}
                          ownerMapStatus={ownerMapStatus}
                          uploading={!!uploading[rowKey]}
                          error={rowError[rowKey] ?? null}
                          onPickFile={(f) => {
                            setFiles((p) => ({ ...p, [rowKey]: f }));
                            clearRowError(rowKey);
                          }}
                          onPickType={(t) => {
                            setTypes((p) => ({ ...p, [rowKey]: t }));
                            // The type decides which owners are valid, so a
                            // choice made for the previous type is moot.
                            setOwnerOverride((p) => {
                              const next = { ...p };
                              delete next[rowKey];
                              return next;
                            });
                            clearRowError(rowKey);
                          }}
                          onPickOwner={(f) => {
                            setOwnerOverride((p) => ({ ...p, [rowKey]: f }));
                            clearRowError(rowKey);
                          }}
                          onUpload={() => void upload(sr, req, rowKey)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
              {complete && detail.requirements.length > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" /> Toutes les pièces de
                  cette demande sont fournies.
                </p>
              )}
            </CardBody>
          </Card>
        );
      })}

      {/* Escape hatch: once every SR has loaded, always offer a way forward —
          even when a requirement can't be satisfied here (a DATA_FIELD, or an
          SR that failed to load) — so the parcours can never deadlock. The
          green success banner above covers the all-complete case. */}
      {allLoaded && !allComplete && (
        <div className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1">
            {anyError
              ? "Une demande n'a pas pu être chargée. Vous pouvez réessayer (Rafraîchir) ou passer à l'instruction."
              : "Certaines exigences ne se complètent pas ici (champ de données à renseigner dans la demande). Vous pouvez tout de même passer à l'instruction."}
          </span>
          <Button variant="outline" size="sm" onClick={onComplete}>
            Continuer vers l&apos;instruction (Phase D)
          </Button>
        </div>
      )}
    </div>
  );
}

function RequirementRow({
  req,
  file,
  selectedType,
  effectiveType: rowType,
  owner,
  ownerMapStatus,
  uploading,
  error,
  onPickFile,
  onPickType,
  onPickOwner,
  onUpload,
}: {
  req: Requirement;
  file: File | null;
  selectedType: string;
  /** The type this row will actually send (pick, or the sole accepted type) —
   *  computed by the parent so the hint, the guard and the upload agree. */
  effectiveType: string;
  /** Owner the document will be attached to, resolved from the chosen type. */
  owner: ResolvedDocumentOwner;
  /** Whether the owner mapping has been read — uploads wait for it. */
  ownerMapStatus: OwnerMapStatus;
  uploading: boolean;
  error: string | null;
  onPickFile: (f: File | null) => void;
  onPickType: (t: string) => void;
  onPickOwner: (f: DocumentOwnerField) => void;
  onUpload: () => void;
}) {
  // DATA_FIELD requirements aren't document uploads — show them read-only so
  // nothing is silently hidden.
  if (req.kind === "DATA_FIELD") {
    return (
      <div className="border-border flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2">
        <span className="text-sm">Champ à compléter</span>
        {req.pointer && (
          <code className="text-muted-foreground font-mono text-[11px]">
            {req.pointer}
          </code>
        )}
        <StatusBadge
          label={req.state}
          tone={reqTone(req.state)}
          className="ml-auto"
        />
        <span className="text-muted-foreground w-full text-[11px]">
          À renseigner via le formulaire de la demande (hors téléversement de
          pièces).
        </span>
      </div>
    );
  }

  const accepted = req.accepted_document_types ?? [];
  const pending = isDocRequirementPending(req);
  // Why the owner isn't settled, if it isn't — the same text the upload guard
  // would produce, shown here instead of behind a disabled button.
  const ownerProblem = describeOwnerProblem(owner);
  // Offer the choice both when several owners are valid and when none was
  // settled but the context holds a usable one (an unknown type, or the owner
  // this SR expects being absent): the user decides rather than being stuck.
  const showOwnerSelect =
    owner.candidates.length > 1 ||
    (!owner.field && owner.candidates.length > 0);

  return (
    <div className="border-border rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {accepted.length === 1
            ? accepted[0]
            : accepted.length
              ? "Document requis"
              : "Document"}
        </span>
        <StatusBadge
          label={req.state}
          tone={reqTone(req.state)}
          className="ml-auto"
        />
      </div>

      {req.document?.id && (
        <p className="text-muted-foreground mt-1 truncate font-mono text-[11px]">
          document : {req.document.id}
          {req.document.type ? ` (${req.document.type})` : ""}
        </p>
      )}
      {req.state === "INVALID" && (
        <p className="text-destructive mt-1 text-xs">
          Document rejeté{req.error_code ? ` — ${req.error_code}` : ""}. Fournissez
          un remplacement.
        </p>
      )}

      {pending ? (
        <div className="mt-2 space-y-2">
          {accepted.length > 1 ? (
            <Field label="Type de document" required>
              <Select value={selectedType} onValueChange={onPickType}>
                <SelectTrigger className="w-full" aria-required>
                  <SelectValue placeholder="Choisir un type" />
                </SelectTrigger>
                <SelectContent>
                  {accepted.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : accepted.length === 0 ? (
            // The requirement constrains no type — fall back to a free-text
            // input (as the old create/attach steps allowed) so it stays
            // fulfillable instead of leaving the upload permanently disabled.
            <Field
              label="Type de document"
              required
              hint="Aucun type imposé par la demande — saisissez le type attendu (ex. PROOF_OF_ADDRESS)."
            >
              <Input
                value={selectedType}
                onChange={(e) => onPickType(e.target.value)}
                placeholder="DOCUMENT_TYPE"
                className="h-8 font-mono text-sm uppercase"
              />
            </Field>
          ) : null}
          {/* Which id the document hangs off is decided by its type, not by
              the service request — surface it, and let an ambiguity (a RIB is
              valid on the person *and* on the payment method) or a gap in the
              context be resolved before anything is sent. */}
          {ownerMapStatus !== "ready" ? (
            <p
              className={cn(
                "text-[11px]",
                ownerMapStatus === "error"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground",
              )}
            >
              {ownerMapStatus === "error"
                ? "Contrat de l'API document illisible — le propriétaire du document ne peut pas être déduit. Synchronisez les specs."
                : "Lecture du contrat de l'API document…"}
            </p>
          ) : !rowType ? null : showOwnerSelect ? (
            <Field
              label="Rattaché à"
              required
              hint={
                ownerProblem ??
                "Propriétaire du document, déduit du type via le contrat de l'API document."
              }
            >
              <Select
                value={owner.field ?? ""}
                onValueChange={(v) => onPickOwner(v as DocumentOwnerField)}
              >
                <SelectTrigger className="w-full" aria-required>
                  <SelectValue placeholder="Choisir un propriétaire" />
                </SelectTrigger>
                <SelectContent>
                  {owner.candidates.map((f) => (
                    <SelectItem key={f} value={f} className="font-mono">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : owner.field ? (
            <p className="text-muted-foreground text-[11px]">
              Rattaché à <code className="font-mono">{owner.field}</code>
            </p>
          ) : (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              {ownerProblem}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "h-8 shrink-0 cursor-pointer text-xs",
              )}
            >
              <Upload className="size-3.5" />
              {file ? "Changer de fichier" : "Choisir un fichier"}
              <input
                type="file"
                className="sr-only"
                onClick={(e) => {
                  (e.currentTarget as HTMLInputElement).value = "";
                }}
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <span
              className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
              title={file?.name}
            >
              {file
                ? `${file.name} — ${formatFileSize(file.size)}`
                : "Aucun fichier sélectionné"}
            </span>
            {file && !uploading && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-7 shrink-0"
                aria-label="Retirer le fichier"
                onClick={() => onPickFile(null)}
              >
                <X className="size-3.5" />
              </Button>
            )}
            <Button
              variant="success"
              size="sm"
              className="h-8 shrink-0 text-xs"
              disabled={
                uploading ||
                !file ||
                !rowType ||
                !owner.field ||
                ownerMapStatus !== "ready"
              }
              onClick={onUpload}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {uploading ? "Envoi…" : "Téléverser"}
            </Button>
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      ) : (
        error && <p className="text-destructive mt-2 text-xs">{error}</p>
      )}
    </div>
  );
}

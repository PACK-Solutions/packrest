"use client";

import { useCallback, useEffect, useState } from "react";
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
import { listApis } from "@/lib/specs";
import {
  extractRequirements,
  extractServiceRequestStatus,
  isDocRequirementPending,
  areRequirementsComplete,
  type Requirement,
} from "@/lib/parcours-documents";
import type { StatusTone } from "@/lib/design";
import type { ProxyResponse } from "@/lib/http";
import { cn, formatFileSize } from "@/lib/utils";

// One service request the form should complete. Built by the Parcours page from
// the shared context (contract / SEPA mandate / beneficiary clause SRs), with
// the document owner inferred per SR type.
export interface ParcoursSrTarget {
  /** Context key of the SR id — used as a stable React key. */
  key: string;
  /** service_request_id. */
  id: string;
  /** Human label shown on the card header. */
  label: string;
  /** Owner field of the created document (createDocument requires ≥1 owner). */
  ownerField: "contract_id" | "payment_method_id" | "person_id";
  ownerId: string;
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

function srTone(status: string | null): StatusTone {
  switch (status) {
    case "APPROVED":
      return "success";
    case "UNDER_REVIEW":
      return "info";
    case "REJECTED":
    case "CANCELLED":
    case "EXPIRED":
      return "danger";
    default:
      return "warn"; // REQUIRES_INFORMATION / unknown
  }
}

// Best-effort human message out of an error response body.
function messageFromRes(res: ProxyResponse | null): string {
  if (!res) return "API introuvable — la spec n'est peut-être pas synchronisée.";
  const body = res.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const r = body as Record<string, unknown>;
    for (const f of ["detail", "message", "title", "error"]) {
      if (typeof r[f] === "string" && (r[f] as string).trim())
        return `HTTP ${res.status} — ${(r[f] as string).trim()}`;
    }
  }
  return `HTTP ${res.status || 0}${res.statusText ? ` — ${res.statusText}` : ""}`;
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

export default function ParcoursDocuments({
  serviceRequests,
  onComplete,
}: Props) {
  const [details, setDetails] = useState<Record<string, SrDetail>>({});
  // Per upload-row (`${srId}#${index}`) transient state.
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [types, setTypes] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});
  // Document id created for a row but not yet attached — lets a retry after an
  // attach failure re-use it instead of minting a duplicate document.
  const [createdDocId, setCreatedDocId] = useState<Record<string, string>>({});
  // Required contracts (service-request / document) that aren't synced yet.
  const [missingApis, setMissingApis] = useState<string[]>([]);

  const fetchSr = useCallback(async (srId: string) => {
    setDetails((prev) => ({
      ...prev,
      [srId]: { ...(prev[srId] ?? EMPTY_DETAIL), loading: true, error: null },
    }));
    const res = await callOperation({
      apiId: "service-request",
      operationId: "getServiceRequestById",
      pathParams: { service_request_id: srId },
    });
    setDetails((prev) => ({
      ...prev,
      [srId]:
        res && isSuccess(res)
          ? {
              loading: false,
              error: null,
              status: extractServiceRequestStatus(res.body),
              requirements: extractRequirements(res.body),
            }
          : {
              loading: false,
              error: messageFromRes(res),
              status: null,
              requirements: [],
            },
    }));
  }, []);

  // Load (and reload) each SR when the target list changes.
  const srIds = serviceRequests.map((s) => s.id).join("|");
  useEffect(() => {
    for (const s of serviceRequests) void fetchSr(s.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srIds, fetchSr]);

  // Flag any required contract that isn't synced — the upload needs both the
  // service-request and document APIs — so we can prompt to synchronise rather
  // than fail with an opaque per-row error.
  useEffect(() => {
    let cancelled = false;
    void listApis().then((ids) => {
      if (cancelled) return;
      setMissingApis(
        ["service-request", "document"].filter((a) => !ids.includes(a)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const upload = useCallback(
    async (sr: ParcoursSrTarget, req: Requirement, rowKey: string) => {
      const file = files[rowKey] ?? null;
      const accepted = req.accepted_document_types ?? [];
      const type =
        types[rowKey] || (accepted.length === 1 ? accepted[0] : "");
      if (!sr.ownerId) {
        setRowError((p) => ({
          ...p,
          [rowKey]:
            "Propriétaire manquant dans le contexte (contract_id / payment_method_id) — complétez-le avant de téléverser.",
        }));
        return;
      }
      if (!file) {
        setRowError((p) => ({ ...p, [rowKey]: "Choisissez un fichier." }));
        return;
      }
      if (!type) {
        setRowError((p) => ({
          ...p,
          [rowKey]: "Choisissez un type de document.",
        }));
        return;
      }
      setUploading((p) => ({ ...p, [rowKey]: true }));
      setRowError((p) => ({ ...p, [rowKey]: null }));
      try {
        // 1) Create the document (multipart) with the SR's owner — but only
        // once: if a prior attempt created the document and then failed at the
        // attach step, reuse that id so a retry re-attaches instead of minting
        // a duplicate. (A new file picked in between clears createdDocId.)
        let documentId: string | null = createdDocId[rowKey] ?? null;
        if (!documentId) {
          const multipart = await buildMultipart(
            { document_type: type, [sr.ownerField]: sr.ownerId },
            { file },
          );
          const created = await callOperation({
            apiId: "document",
            operationId: "createDocument",
            multipart,
          });
          if (!created || !isSuccess(created)) {
            setRowError((p) => ({ ...p, [rowKey]: messageFromRes(created) }));
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
          const createdId = documentId;
          setCreatedDocId((p) => ({ ...p, [rowKey]: createdId }));
        }
        // 2) Attach it to the service request (matches the requirement on type).
        const attached = await callOperation({
          apiId: "service-request",
          operationId: "attachServiceRequestDocument",
          pathParams: { service_request_id: sr.id },
          body: { document_id: documentId, type },
        });
        if (!attached || !isSuccess(attached)) {
          setRowError((p) => ({ ...p, [rowKey]: messageFromRes(attached) }));
          return;
        }
        // Success — drop the picked file + remembered doc id, and refresh the SR
        // to reflect the new requirement state (and a possible UNDER_REVIEW).
        setFiles((p) => ({ ...p, [rowKey]: null }));
        setCreatedDocId((p) => {
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
    [files, types, createdDocId, fetchSr],
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
      {missingApis.length > 0 && (
        <Card tone="warn">
          <CardBody className="space-y-2 p-3 text-sm">
            <p className="text-muted-foreground">
              Contrat(s) non synchronisé(s) :{" "}
              <span className="font-mono">{missingApis.join(", ")}</span>. Le
              téléversement des pièces nécessite les APIs service-request et
              document.
            </p>
            <a href="/settings" className="text-primary underline">
              Ouvrir les Paramètres pour synchroniser
            </a>
          </CardBody>
        </Card>
      )}
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
        return (
          <Card key={sr.key} tone="info">
            <CardHeader tone="info">
              <span className="font-semibold">{sr.label}</span>
              {detail.status && (
                <StatusBadge
                  label={detail.status}
                  tone={srTone(detail.status)}
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
                    const rowKey = `${sr.id}#${index}`;
                    return (
                      <li key={rowKey}>
                        <RequirementRow
                          req={req}
                          file={files[rowKey] ?? null}
                          selectedType={types[rowKey] ?? ""}
                          uploading={!!uploading[rowKey]}
                          error={rowError[rowKey] ?? null}
                          onPickFile={(f) => {
                            setFiles((p) => ({ ...p, [rowKey]: f }));
                            // A new file invalidates a document created in a
                            // prior failed attempt, and clears the stale error.
                            setCreatedDocId((p) => {
                              const next = { ...p };
                              delete next[rowKey];
                              return next;
                            });
                            setRowError((p) => ({ ...p, [rowKey]: null }));
                          }}
                          onPickType={(t) =>
                            setTypes((p) => ({ ...p, [rowKey]: t }))
                          }
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
  uploading,
  error,
  onPickFile,
  onPickType,
  onUpload,
}: {
  req: Requirement;
  file: File | null;
  selectedType: string;
  uploading: boolean;
  error: string | null;
  onPickFile: (f: File | null) => void;
  onPickType: (t: string) => void;
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
  const effectiveType =
    selectedType || (accepted.length === 1 ? accepted[0] : "");

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
              disabled={uploading || !file || !effectiveType}
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

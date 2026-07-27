"use client";

// Phase D « Instruire les demandes » — the quick-decision view.
//
// Mirrors ParcoursDocuments (one card per service request, per-card refresh and
// error, an explicit way forward) but for the reviewer side: it lists only the
// SRs of the *current* parcours run and records APPROVED / REJECTED inline,
// without walking the list → consult → decide operations one form at a time.
//
// Scoping is deliberately belt-and-braces. `listServiceRequests` is called once
// per resource of the run with target_resource_type/target_resource_id, AND the
// rows that come back are re-filtered against their own `target_resource`
// (scopeServiceRequests): a decision here is terminal, so a server that ignores
// an unknown query filter must not turn « Tout approuver » into a tenant-wide
// approval.
//
// The decision endpoint answers 204, so each decision is followed by a re-read
// of the SR to show its new status — and a failed re-read is reported instead of
// leaving a decided demand looking undecided.

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ThumbsUp, X } from "lucide-react";

import { Card, CardHeader, CardBody } from "@/components/Card";
import ConfirmDialog from "@/components/ConfirmDialog";
import Field from "@/components/Field";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { callOperation } from "@/lib/operation-fetch";
import { isSuccess, type ContextValues } from "@/lib/parcours";
import {
  buildDecisionBody,
  contextKeyForSrType,
  defaultRejectionMessage,
  extractServiceRequests,
  isDecidable,
  mergeServiceRequests,
  parseServiceRequest,
  REJECTION_REASONS,
  scopeServiceRequests,
  srTypeLabel,
  summariseRequirements,
  type DecisionTarget,
  type QuickDecisionOutcome,
  type ServiceRequestRow,
} from "@/lib/parcours-decisions";
import { srStatusTone } from "@/lib/design";
import { apiErrorMessage } from "@/lib/http";
import { cn } from "@/lib/utils";

// What the page hands over: the SR ids the run captured, and the resources those
// SRs hang off — the two ways of scoping the reviewer's work to the current
// parcours instead of the tenant's whole UNDER_REVIEW backlog. No labels: a
// card is named from the SR's own `type`.
export interface ParcoursDecisionScope {
  /** SR ids captured in the parcours context. */
  contextSrIds: string[];
  /** Target resources of the run, used to discover the SRs it produced. */
  discover: DecisionTarget[];
}

interface Props {
  scope: ParcoursDecisionScope;
  /** Write ids back into the parcours context — an SR discovered here that the
   *  context lost (a re-run cleared it) must become usable by Phase C again,
   *  which the removed picker step used to ensure. */
  onCapture: (values: ContextValues) => void;
  /** Called (via an explicit button) to advance the parcours to the follow-up
   *  steps, whether or not every SR ended up decided. */
  onComplete: () => void;
}

const DECIDE_HINTS = {
  403: "le scope service-requests:admin est requis pour décider",
  409: "la demande n'est plus en UNDER_REVIEW — rafraîchissez",
};

/** Per-row rejection draft, opened by « Rejeter ». */
interface RejectDraft {
  code: string;
  message: string;
}

export default function ParcoursDecisions({
  scope,
  onCapture,
  onComplete,
}: Props) {
  const [rows, setRows] = useState<ServiceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  // Per-SR transient state.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});
  const [rejecting, setRejecting] = useState<Record<string, RejectDraft>>({});
  // Ids whose decision the API accepted (204) but whose re-read failed: the
  // status on screen is stale, so no second decision may be offered.
  const [decided, setDecided] = useState<Record<string, QuickDecisionOutcome>>(
    {},
  );
  const [confirmingApproveAll, setConfirmingApproveAll] = useState(false);

  // Signatures so the load effect re-runs on a real scope change, not on every
  // render of the parent (which rebuilds the arrays).
  const contextIdsKey = scope.contextSrIds.join("|");
  const discoverKey = scope.discover
    .map((d) => `${d.resourceType}:${d.resourceId}`)
    .join("|");

  // Monotonic load token: only the newest load may commit. Without it a slow
  // load started under the previous scope (a corrected contract_id) can land
  // last and show another contract's demands — which « Approuver » would then
  // decide for real.
  const loadTokenRef = useRef(0);

  const fetchOne = useCallback(
    async (
      srId: string,
    ): Promise<{ row: ServiceRequestRow | null; error: string | null }> => {
      const res = await callOperation({
        apiId: "service-request",
        operationId: "getServiceRequestById",
        pathParams: { service_request_id: srId },
      });
      if (!res || !isSuccess(res))
        return { row: null, error: apiErrorMessage(res) };
      const row = parseServiceRequest(res.body);
      return {
        row,
        error: row ? null : "Réponse inattendue (aucun id de demande).",
      };
    },
    [],
  );

  // Load everything in scope: one list call per target resource of the run (in
  // parallel), plus a GET for each context id the list calls didn't return.
  const loadAll = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setLoadErrors([]);
    const targets = scope.discover;
    const contextIds = scope.contextSrIds;
    const problems: string[] = [];

    const listed = await Promise.all(
      targets.map(async (d) => {
        const res = await callOperation({
          apiId: "service-request",
          operationId: "listServiceRequests",
          // Non-path params are appended as a query string by callOperation, so
          // the list is filtered server-side on this run's resource — and
          // re-filtered below, since that filter can't be trusted blindly.
          pathParams: {
            target_resource_type: d.resourceType,
            target_resource_id: d.resourceId,
          },
          method: "GET",
        });
        if (res && isSuccess(res)) return extractServiceRequests(res.body);
        problems.push(
          `${d.resourceType} ${d.resourceId} : ${apiErrorMessage(res)}`,
        );
        return [];
      }),
    );

    const known = new Set(listed.flat().map((r) => r.id));
    const fetched = (
      await Promise.all(
        contextIds
          .filter((id) => !known.has(id))
          .map(async (id) => {
            const { row, error } = await fetchOne(id);
            if (!row) problems.push(`demande ${id} : ${error}`);
            return row;
          }),
      )
    ).filter((r): r is ServiceRequestRow => !!r);

    if (token !== loadTokenRef.current) return; // a newer load owns the state
    // Fetched-by-id rows first: they carry the fullest payload. Everything the
    // list calls returned is filtered down to this run before it can be decided.
    const merged = mergeServiceRequests(
      fetched,
      scopeServiceRequests(listed.flat(), targets, contextIds),
    );
    setRows(merged);
    setLoading(false);
    // Every failure is reported, not just the "nothing loaded" case: a demand
    // silently missing from this list reads as « rien à instruire » and would be
    // left UNDER_REVIEW forever.
    setLoadErrors(problems);

    // Give Phase C back the ids this run lost: an SR discovered here whose type
    // maps to an empty context key.
    const captured: ContextValues = {};
    const contextIdSet = new Set(contextIds);
    for (const row of merged) {
      if (contextIdSet.has(row.id)) continue;
      const key = contextKeyForSrType(row.type);
      if (key && !captured[key]) captured[key] = row.id;
    }
    if (Object.keys(captured).length) onCapture(captured);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextIdsKey, discoverKey, fetchOne, onCapture]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Refresh a single SR in place (after a decision, or on demand).
  const refreshOne = useCallback(
    async (srId: string) => {
      setBusy((p) => ({ ...p, [srId]: true }));
      const { row, error } = await fetchOne(srId);
      if (row) {
        setRows((prev) => prev.map((r) => (r.id === srId ? row : r)));
        setRowError((p) => ({ ...p, [srId]: null }));
        setDecided((p) => {
          const next = { ...p };
          delete next[srId]; // the status on screen is authoritative again
          return next;
        });
      } else {
        setRowError((p) => ({ ...p, [srId]: error }));
      }
      setBusy((p) => ({ ...p, [srId]: false }));
    },
    [fetchOne],
  );

  const decide = useCallback(
    async (
      srId: string,
      outcome: QuickDecisionOutcome,
      rejection?: RejectDraft,
    ) => {
      setBusy((p) => ({ ...p, [srId]: true }));
      setRowError((p) => ({ ...p, [srId]: null }));
      const res = await callOperation({
        apiId: "service-request",
        operationId: "decideServiceRequest",
        pathParams: { service_request_id: srId },
        body: buildDecisionBody(outcome, rejection),
      });
      if (!res || !isSuccess(res)) {
        setRowError((p) => ({
          ...p,
          [srId]: apiErrorMessage(res, { hints: DECIDE_HINTS }),
        }));
        setBusy((p) => ({ ...p, [srId]: false }));
        return;
      }
      // 204 — no body. Record the outcome BEFORE the re-read, so a failed
      // re-read can't leave the card offering a second (409-bound) decision.
      setDecided((p) => ({ ...p, [srId]: outcome }));
      setRejecting((p) => {
        const next = { ...p };
        delete next[srId];
        return next;
      });
      const { row, error } = await fetchOne(srId);
      if (row) {
        setRows((prev) => prev.map((r) => (r.id === srId ? row : r)));
        // The re-read succeeded: the status on screen is authoritative again, so
        // the local "already decided" marker is no longer what gates the buttons.
        setDecided((p) => {
          const next = { ...p };
          delete next[srId];
          return next;
        });
      } else {
        setRowError((p) => ({
          ...p,
          [srId]: `Décision enregistrée, mais la relecture de la demande a échoué (${error}) — rafraîchissez pour voir son nouveau statut.`,
        }));
      }
      setBusy((p) => ({ ...p, [srId]: false }));
    },
    [fetchOne],
  );

  // A row is actionable when the API accepts a decision on it AND we haven't
  // already recorded one whose confirmation we couldn't read back.
  const actionable = (row: ServiceRequestRow) =>
    isDecidable(row) && !decided[row.id];
  const decidable = rows.filter(actionable);
  const anyBusy = Object.values(busy).some(Boolean);

  const approveAll = useCallback(
    async (targets: ServiceRequestRow[]) => {
      await Promise.all(targets.map((row) => decide(row.id, "APPROVED")));
    },
    [decide],
  );

  if (!scope.contextSrIds.length && !scope.discover.length) {
    return (
      <Card tone="warn">
        <CardBody className="space-y-2 p-4 text-sm">
          <p className="text-muted-foreground">
            Aucune demande dans le contexte : soumettez d&apos;abord le contrat
            (Phase B) pour ouvrir une demande de souscription.
          </p>
          <Button variant="outline" size="sm" onClick={onComplete}>
            Continuer vers le suivi
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
        <span className="text-muted-foreground min-w-0 flex-1">
          {loading
            ? "Chargement des demandes du parcours…"
            : decidable.length
              ? `${decidable.length} demande${decidable.length > 1 ? "s" : ""} à instruire sur ${rows.length} du parcours.`
              : `${rows.length} demande${rows.length > 1 ? "s" : ""} du parcours — aucune n'attend de décision.`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => void loadAll()}
          disabled={loading || anyBusy}
          title="Recharger les demandes du parcours"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Rafraîchir
        </Button>
        {decidable.length > 1 && (
          <Button
            variant="success"
            size="sm"
            onClick={() => setConfirmingApproveAll(true)}
            disabled={anyBusy}
          >
            <ThumbsUp className="size-3.5" />
            Tout approuver ({decidable.length})
          </Button>
        )}
      </div>

      {/* A terminal, irreversible decision on several demands at once is
          confirmed first — the deleted « Décider » step at least made the
          reviewer fill a form per demand. */}
      <ConfirmDialog
        open={confirmingApproveAll}
        title={`Approuver ${decidable.length} demandes ?`}
        description={`Décision définitive (APPROVED) sur : ${decidable
          .map((r) => `${srTypeLabel(r.type)} (${r.id})`)
          .join(", ")}. Une demande approuvée ne peut plus être instruite.`}
        confirmLabel="Tout approuver"
        onConfirm={() => {
          const targets = decidable;
          setConfirmingApproveAll(false);
          void approveAll(targets);
        }}
        onCancel={() => setConfirmingApproveAll(false)}
      />

      {loadErrors.length > 0 && (
        <Card tone="danger">
          <CardBody className="space-y-1 p-3 text-sm">
            <p>
              {rows.length
                ? "Certaines demandes n'ont pas pu être chargées — la liste ci-dessous est incomplète :"
                : "Aucune demande n'a pu être chargée :"}
            </p>
            <ul className="space-y-0.5 text-xs">
              {loadErrors.map((e, i) => (
                <li key={i} className="font-mono">
                  {e}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {loading && !rows.length && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-3.5 animate-spin" /> Lecture des demandes…
        </p>
      )}

      {rows.map((row) => {
        const draft = rejecting[row.id];
        const canDecide = actionable(row);
        const rowBusy = !!busy[row.id];
        return (
          // Tonal only while a decision is expected — a resolved SR reads as
          // plain history.
          <Card key={row.id} tone={canDecide ? "info" : undefined}>
            <CardHeader tone={canDecide ? "info" : undefined}>
              <span className="font-semibold">{srTypeLabel(row.type)}</span>
              {row.status && (
                <StatusBadge
                  label={row.status}
                  tone={srStatusTone(row.status)}
                  className="ml-2"
                />
              )}
              <code className="text-muted-foreground ml-2 truncate font-mono text-[11px]">
                {row.id}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={() => void refreshOne(row.id)}
                disabled={rowBusy}
                title="Rafraîchir la demande"
              >
                <RefreshCw className={cn("size-3.5", rowBusy && "animate-spin")} />
                Rafraîchir
              </Button>
            </CardHeader>
            <CardBody className="space-y-3 p-3">
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {row.type && <span className="font-mono">{row.type}</span>}
                <span>{summariseRequirements(row)}</span>
                {row.targetType && row.targetId && (
                  <span className="truncate">
                    cible : {row.targetType}{" "}
                    <code className="font-mono">{row.targetId}</code>
                  </span>
                )}
              </div>
              {row.reason && <p className="text-sm">{row.reason}</p>}

              {row.rejections.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {row.rejections.map((r, i) => (
                    <li key={`${r.code}-${i}`} className="text-destructive">
                      {r.code}
                      {r.message ? ` — ${r.message}` : ""}
                    </li>
                  ))}
                </ul>
              )}

              {rowError[row.id] && (
                <p className="text-destructive text-sm">{rowError[row.id]}</p>
              )}

              {canDecide ? (
                draft ? (
                  // Rejection needs a structured reason; the message is
                  // pre-filled from the code so a rejection stays a 2-click
                  // action, and stays editable.
                  <div className="space-y-2">
                    <Field label="Motif de rejet" required>
                      <Select
                        value={draft.code}
                        onValueChange={(code) =>
                          setRejecting((p) => ({
                            ...p,
                            [row.id]: {
                              code,
                              // Keep an edited message, refresh a default one.
                              message:
                                p[row.id]?.message ===
                                defaultRejectionMessage(p[row.id]?.code ?? "")
                                  ? defaultRejectionMessage(code)
                                  : (p[row.id]?.message ?? ""),
                            },
                          }))
                        }
                      >
                        <SelectTrigger className="w-full" aria-required>
                          <SelectValue placeholder="Choisir un motif" />
                        </SelectTrigger>
                        <SelectContent>
                          {REJECTION_REASONS.map((r) => (
                            <SelectItem key={r.code} value={r.code}>
                              {r.label} ({r.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field
                      label="Message au partenaire"
                      required
                      hint="Visible par le partenaire dans rejections[]."
                    >
                      <Input
                        value={draft.message}
                        onChange={(e) =>
                          setRejecting((p) => ({
                            ...p,
                            [row.id]: { ...draft, message: e.target.value },
                          }))
                        }
                        placeholder="Motif détaillé"
                        className="h-8 text-sm"
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void decide(row.id, "REJECTED", draft)}
                        disabled={rowBusy || !draft.code}
                      >
                        {rowBusy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <X className="size-3.5" />
                        )}
                        Confirmer le rejet
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setRejecting((p) => {
                            const next = { ...p };
                            delete next[row.id];
                            return next;
                          })
                        }
                        disabled={rowBusy}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => void decide(row.id, "APPROVED")}
                      disabled={rowBusy}
                    >
                      {rowBusy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
                      Approuver
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setRejecting((p) => ({
                          ...p,
                          [row.id]: {
                            code: REJECTION_REASONS[0].code,
                            message: REJECTION_REASONS[0].message,
                          },
                        }))
                      }
                      disabled={rowBusy}
                    >
                      <X className="size-3.5" />
                      Rejeter
                    </Button>
                  </div>
                )
              ) : (
                <p className="text-muted-foreground text-xs">
                  {decided[row.id]
                    ? `Décision ${decided[row.id]} déjà enregistrée sur cette demande — rafraîchissez pour lire son statut à jour.`
                    : row.status === "REQUIRES_INFORMATION"
                      ? "Des pièces ou informations manquent — complétez la demande en Phase C avant de décider."
                      : "Demande déjà résolue — aucune décision possible (409 sur une demande close)."}
                </p>
              )}
            </CardBody>
          </Card>
        );
      })}

      {/* Always offer a way forward: an SR that can't be decided here (already
          resolved, or awaiting information) must not deadlock the parcours. */}
      {!loading && (
        <div className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1">
            {decidable.length
              ? "Vous pouvez aussi passer au suivi et revenir instruire plus tard."
              : "Instruction terminée — observez le contrat et la personne dans les étapes suivantes."}
          </span>
          <Button
            variant={decidable.length ? "outline" : "success"}
            size="sm"
            onClick={onComplete}
          >
            Continuer vers le suivi
          </Button>
        </div>
      )}
    </div>
  );
}

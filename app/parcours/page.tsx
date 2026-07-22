"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, SkipForward } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardHeader, CardBody } from "@/components/Card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import RequestBuilder from "@/components/RequestBuilder";
import ParcoursStepper from "@/components/ParcoursStepper";
import ParcoursContextPanel from "@/components/ParcoursContextPanel";
import ParcoursSelect from "@/components/ParcoursSelect";
import Markdown from "@/components/Markdown";
import {
  FieldOptionsProvider,
  type FieldOptionsMap,
} from "@/components/FieldOptionsContext";
import { fetchOperationJson } from "@/lib/operation-fetch";
import { apiTheme } from "@/lib/design";
import {
  extractOAuth2,
  findEndpoint,
  loadSpec,
  type EndpointEntry,
} from "@/lib/specs";
import type { OpenApiDocument } from "@/lib/types";
import type { ProxyResponse } from "@/lib/http";
import {
  advanceState,
  buildSeedForStep,
  clearParcoursState,
  extractProduced,
  extractOptions,
  getParcours,
  initialState,
  isSuccess,
  loadParcoursState,
  saveParcoursState,
  type ContextKey,
  type ParcoursState,
  type ParcoursStep,
  type StepDraft,
} from "@/lib/parcours";

interface LoadedEntry {
  /** The step this entry was resolved for — guards against a stale async
   *  resolution painting the previous step's endpoint on the current step. */
  stepId: string;
  spec: OpenApiDocument;
  entry: EndpointEntry;
  scopes: Record<string, string>;
  tokenUrl: string;
}

function Parcours() {
  const id = useSearchParams().get("id") || "souscription";
  const def = getParcours(id);

  // Wizard state (values + progress). Hydrated from sessionStorage on mount so
  // an in-progress parcours survives navigation/refresh.
  const [state, setState] = useState<ParcoursState | null>(null);
  useEffect(() => {
    if (def) setState(loadParcoursState(def));
  }, [def]);

  const activeStep: ParcoursStep | null =
    (def && state && def.steps.find((s) => s.id === state.currentStepId)) ||
    null;

  // Resolve the active step's endpoint (spec + operation) the same way the
  // single-endpoint page does.
  const [loaded, setLoaded] = useState<LoadedEntry | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(true);
  // Tagged with the step it belongs to so an adjacent picker step never renders
  // the previous step's response through its own SelectSpec (mirrors LoadedEntry).
  const [stepResponse, setStepResponse] =
    useState<{ stepId: string; res: ProxyResponse } | null>(null);
  // Fetched option lists for the active step's `fieldOptions`, tagged by step id
  // so a stale fetch can't paint the wrong step's pickers.
  const [fieldOpts, setFieldOpts] = useState<{
    stepId: string;
    map: FieldOptionsMap;
  } | null>(null);
  useEffect(() => {
    if (!activeStep) return;
    let cancelled = false;
    setLoadingEntry(true);
    setLoaded(null);
    setStepResponse(null);
    loadSpec(activeStep.apiId).then((spec) => {
      if (cancelled) return;
      const entry = spec ? findEndpoint(spec, activeStep.apiId, activeStep.operationId) : null;
      if (spec && entry) {
        const oauth = extractOAuth2(spec);
        setLoaded({
          stepId: activeStep.id,
          spec,
          entry,
          scopes: oauth?.flows.clientCredentials?.scopes ?? {},
          tokenUrl: oauth?.flows.clientCredentials?.tokenUrl ?? "",
        });
      } else {
        setLoaded(null);
      }
      setLoadingEntry(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeStep]);

  // Fetch dropdown options for the active step's `fieldOptions` (e.g. the chosen
  // product's funds) so matching leaf inputs in the body form become searchable
  // pickers. Tagged by step id (like `loaded`) so a slow fetch never paints
  // options on the wrong step. A source whose params aren't all present yet is
  // skipped (that field stays a text input); any non-2xx response is ignored.
  useEffect(() => {
    if (!activeStep?.fieldOptions?.length || !state) {
      setFieldOpts(null);
      return;
    }
    const stepId = activeStep.id;
    const sources = activeStep.fieldOptions;
    const values = state.values;
    let cancelled = false;
    (async () => {
      const map: FieldOptionsMap = {};
      for (const src of sources) {
        const params: Record<string, string> = {};
        let ready = true;
        for (const p of src.params) {
          const v = values[p.from];
          if (!v) {
            ready = false;
            break;
          }
          params[p.name] = v;
        }
        if (!ready) continue;
        const res = await fetchOperationJson(src.apiId, src.operationId, params);
        if (cancelled) return;
        if (res && isSuccess(res)) {
          map[src.field] = extractOptions(res.body, src.select).map((o) => ({
            value: o.id,
            label: o.detail ? `${o.label} · ${o.detail}` : o.label,
          }));
        }
      }
      if (!cancelled) setFieldOpts({ stepId, map });
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on `state.values` (not the whole `state`) so a per-keystroke draft
    // save — which changes `state` but keeps `values` — doesn't refetch options.
  }, [activeStep, state?.values]);

  const onResult = useCallback(
    (step: ParcoursStep, res: ProxyResponse, method: string) => {
      setStepResponse({ stepId: step.id, res });
      if (!def || !isSuccess(res)) return; // stay on the step so the user can fix + retry
      if (step.selects) return; // picker step — wait for the user to choose a row
      setState((prev) => {
        if (!prev) return prev;
        const next = advanceState(prev, def, step.id, extractProduced(step, res));
        // A GET is a read (consulter / suivre) — mark it done for progress but
        // keep the user on the step so they can read the response, instead of
        // skipping ahead. Writes (POST/PUT/DELETE) advance as before.
        const settled =
          method === "GET" ? { ...next, currentStepId: step.id } : next;
        saveParcoursState(settled);
        return settled;
      });
    },
    [def],
  );

  // A picker selection was confirmed: write the chosen id(s) into the context
  // (comma-joined for multi-select), then advance.
  const onConfirm = useCallback(
    (step: ParcoursStep, ids: string[]) => {
      if (!def || !step.selects) return;
      const key = step.selects.key;
      const value = step.selects.multiSelect ? ids.join(",") : (ids[0] ?? "");
      if (!value) return;
      setState((prev) => {
        if (!prev) return prev;
        const withValue = {
          ...prev,
          values: { ...prev.values, [key]: value },
        };
        const next = advanceState(withValue, def, step.id, {});
        saveParcoursState(next);
        return next;
      });
    },
    [def],
  );

  const setValue = useCallback((key: ContextKey, value: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, values: { ...prev.values, [key]: value } };
      saveParcoursState(next);
      return next;
    });
  }, []);

  const selectStep = useCallback((stepId: string) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, currentStepId: stepId };
      saveParcoursState(next);
      return next;
    });
  }, []);

  // Persist a step's form draft (params + body) so returning to it restores the
  // input. Keep `values`/`done` refs stable so the options-fetch effect (keyed
  // on `state.values`) doesn't re-run on a save.
  const saveDraft = useCallback((stepId: string, draft: StepDraft) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, drafts: { ...prev.drafts, [stepId]: draft } };
      saveParcoursState(next);
      return next;
    });
  }, []);

  const skipStep = useCallback(() => {
    if (!def || !activeStep) return;
    setState((prev) => {
      if (!prev) return prev;
      const next = advanceState(prev, def, activeStep.id, {});
      saveParcoursState(next);
      return next;
    });
  }, [def, activeStep]);

  const reset = useCallback(() => {
    if (!def) return;
    clearParcoursState();
    setState(initialState(def));
  }, [def]);

  if (!def) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <p className="text-sm">
          Parcours introuvable : <code className="font-mono">{id}</code>.
        </p>
        <Link href="/" className="text-primary text-sm underline">
          Retour à l&apos;accueil
        </Link>
      </div>
    );
  }

  const theme = activeStep ? apiTheme(activeStep.apiId) : null;

  // Only trust `loaded` when it belongs to the active step: an async spec
  // resolution left over from the previous step must never paint its endpoint
  // against the new step (which showed the wrong API otherwise).
  const stepEntry =
    loaded && activeStep && loaded.stepId === activeStep.id ? loaded : null;
  const resolving =
    !!activeStep &&
    (loadingEntry || (!!loaded && loaded.stepId !== activeStep.id));

  // Linear step navigation for the step card: Précédent always steps back one
  // (returning to correct an earlier step is always allowed); Suivant advances
  // only to an already-done step or the frontier (first not-done step), mirroring
  // the stepper so the user can't jump past a step they haven't run.
  const stepIndex = activeStep
    ? def.steps.findIndex((s) => s.id === activeStep.id)
    : -1;
  const prevStep = stepIndex > 0 ? def.steps[stepIndex - 1] : null;
  const nextStep =
    stepIndex >= 0 && stepIndex < def.steps.length - 1
      ? def.steps[stepIndex + 1]
      : null;
  const frontierId = state
    ? def.steps.find((s) => !state.done.includes(s.id))?.id
    : undefined;
  const canGoNext =
    !!nextStep &&
    !!state &&
    (state.done.includes(nextStep.id) || nextStep.id === frontierId);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Accueil</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{def.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="space-y-1">
        <h1 className="from-foreground to-muted-foreground bg-gradient-to-r bg-clip-text text-2xl font-semibold text-transparent">
          {def.title}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{def.subtitle}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-[4.5rem] lg:self-start">
          {state && (
            <ParcoursStepper
              def={def}
              currentStepId={state.currentStepId}
              done={state.done}
              onSelect={selectStep}
            />
          )}
        </aside>

        <div className="@container min-w-0 space-y-4">
          {state && (
            <ParcoursContextPanel
              values={state.values}
              onChange={setValue}
              onReset={reset}
            />
          )}

          {activeStep && (
            <Card tone="info">
              <CardHeader tone="info">
                <span className="font-semibold">{activeStep.title}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {theme?.label}
                  {activeStep.actor ? ` · ${activeStep.actor}` : ""}
                </span>
                {activeStep.optional && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 text-xs"
                    onClick={skipStep}
                    title="Marquer comme faite sans l'exécuter"
                  >
                    <SkipForward className="size-3.5" /> Passer
                  </Button>
                )}
              </CardHeader>
              {activeStep.description && (
                <CardBody className="p-3">
                  <Markdown
                    content={activeStep.description}
                    className="text-muted-foreground text-sm"
                  />
                </CardBody>
              )}
            </Card>
          )}

          {activeStep && (prevStep || nextStep) && (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={!prevStep}
                onClick={() => prevStep && selectStep(prevStep.id)}
                title={prevStep ? `Revenir à : ${prevStep.title}` : undefined}
              >
                <ChevronLeft className="size-3.5" /> Précédent
              </Button>
              <span className="text-muted-foreground text-xs">
                Étape {stepIndex + 1} / {def.steps.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={!canGoNext}
                onClick={() => nextStep && selectStep(nextStep.id)}
                title={
                  canGoNext
                    ? `Aller à : ${nextStep?.title}`
                    : "Exécutez cette étape pour débloquer la suivante"
                }
              >
                Suivant <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}

          {resolving && (
            <div
              role="status"
              aria-label="Chargement de l'étape"
              className="space-y-3"
            >
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {!resolving && activeStep && !stepEntry && (
            <Card tone="warn">
              <CardBody className="space-y-2 p-3 text-sm">
                <p>
                  Opération introuvable :{" "}
                  <code className="font-mono">{activeStep.operationId}</code> dans{" "}
                  <code className="font-mono">{activeStep.apiId}</code>. La spec
                  n&apos;est peut-être pas synchronisée.
                </p>
                <Link href="/settings" className="text-primary underline">
                  Ouvrir les Paramètres pour synchroniser
                </Link>
              </CardBody>
            </Card>
          )}

          {!resolving && activeStep && stepEntry && state && (
            <FieldOptionsProvider
              value={
                fieldOpts && fieldOpts.stepId === activeStep.id
                  ? fieldOpts.map
                  : {}
              }
            >
              <RequestBuilder
                key={activeStep.id}
                apiId={activeStep.apiId}
                apiTitle={stepEntry.spec.info.title}
                method={stepEntry.entry.method.toUpperCase()}
                path={stepEntry.entry.path}
                operationId={stepEntry.entry.operationId}
                operation={stepEntry.entry.operation}
                pathParameters={stepEntry.entry.pathItem.parameters ?? []}
                defaultBaseUrl={stepEntry.spec.servers?.[0]?.url ?? ""}
                scopes={stepEntry.scopes}
                tokenUrl={stepEntry.tokenUrl}
                seed={buildSeedForStep(activeStep, state.values)}
                onResult={(res) =>
                  onResult(activeStep, res, stepEntry.entry.method.toUpperCase())
                }
                simplified
                initialDraft={state.drafts?.[activeStep.id]}
                onDraftChange={(draft) => saveDraft(activeStep.id, draft)}
                compactResponse={!!activeStep.selects}
              />
            </FieldOptionsProvider>
          )}

          {activeStep?.selects &&
            stepResponse &&
            stepResponse.stepId === activeStep.id &&
            isSuccess(stepResponse.res) &&
            state && (
              <ParcoursSelect
                key={`picker-${activeStep.id}`}
                title={`Sélectionnez : ${activeStep.title}`}
                options={extractOptions(stepResponse.res.body, activeStep.selects)}
                multiSelect={activeStep.selects.multiSelect}
                selectedIds={
                  activeStep.selects.multiSelect
                    ? (state.values[activeStep.selects.key] ?? "")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : state.values[activeStep.selects.key]
                      ? [state.values[activeStep.selects.key] as string]
                      : []
                }
                onConfirm={(ids) => onConfirm(activeStep, ids)}
              />
            )}
        </div>
      </div>
    </div>
  );
}

export default function ParcoursPage() {
  return (
    <Suspense>
      <Parcours />
    </Suspense>
  );
}

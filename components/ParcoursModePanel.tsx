"use client";

import { Hand, ListChecks, Loader2, Square, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/Card";
import type { ParcoursMode, ParcoursStep } from "@/lib/parcours";

// Status of the fully-automatic run, owned by app/parcours/page.tsx.
export type AutoPhase =
  | "idle"
  | "running"
  | "paused-picker"
  | "error"
  | "finished";

const MODES: {
  value: ParcoursMode;
  label: string;
  Icon: typeof Hand;
  hint: string;
}[] = [
  {
    value: "manual",
    label: "Manuel",
    Icon: Hand,
    hint: "Vous remplissez et exécutez chaque étape vous-même — les formulaires démarrent vides.",
  },
  {
    value: "semi",
    label: "Semi-auto",
    Icon: ListChecks,
    hint: "Chaque étape est préremplie avec des données aléatoires : vérifiez puis cliquez sur « Exécuter » pour passer à la suivante.",
  },
  {
    value: "auto",
    label: "Auto",
    Icon: Wand2,
    hint: "",
  },
];

// Steps whose title already says « (optionnel) » would read « ... (optionnel) »
// twice next to a checkbox that says as much — drop the suffix.
function shortTitle(step: ParcoursStep): string {
  return step.title.replace(/\s*\(optionnel\)\s*$/i, "");
}

// Mode selector for the parcours + the launch/stop/resume controls of the fully
// automatic run, and (in auto mode) the checklist of optional steps the run must
// execute. Purely presentational: the mode value, the selection and the runner
// lifecycle (aborts, state advancement) live in the page (see lib/parcours-auto.ts).
export default function ParcoursModePanel({
  mode,
  onModeChange,
  disabled,
  autoPhase,
  autoStepTitle,
  onAutoStart,
  onAutoStop,
  optionalSteps,
  selectedOptional,
  onToggleOptional,
}: {
  mode: ParcoursMode;
  onModeChange: (mode: ParcoursMode) => void;
  /** Lock the selector while the auto-run drives the steps. */
  disabled?: boolean;
  autoPhase: AutoPhase;
  /** Title of the step currently executing (auto running phase only). */
  autoStepTitle?: string;
  onAutoStart: () => void;
  onAutoStop: () => void;
  /** The optional steps the auto run can be told to execute (page-computed via
   *  `optionalAutoSteps`). */
  optionalSteps: ParcoursStep[];
  /** Ids among them the run must execute; the others are skipped. A tick stays
   *  actionable even once the step is "done": the runner cannot tell a step that
   *  ran from one skipped for being unticked, so it retries a ticked one. */
  selectedOptional: string[];
  onToggleOptional: (stepId: string, run: boolean) => void;
}) {
  const active = MODES.find((m) => m.value === mode) ?? MODES[0];
  return (
    <Card>
      <CardBody className="space-y-2 p-3">
        <div
          role="tablist"
          aria-label="Mode du parcours"
          className="bg-muted grid grid-cols-3 gap-1 rounded-md p-1"
        >
          {MODES.map((m) => {
            const isActive = m.value === mode;
            return (
              <button
                key={m.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                disabled={disabled}
                onClick={() => onModeChange(m.value)}
                className={
                  "flex items-center justify-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 " +
                  (isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <m.Icon className="size-3.5 shrink-0" />
                {m.label}
              </button>
            );
          })}
        </div>

        {mode !== "auto" ? (
          <p className="text-muted-foreground text-[11px] leading-snug">
            {active.hint}
          </p>
        ) : autoPhase === "running" ? (
          <>
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <span className="min-w-0 flex-1 leading-snug">
                Exécution : {autoStepTitle ?? "…"}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAutoStop}
              className="w-full text-xs"
            >
              <Square className="size-3" /> Arrêter
            </Button>
          </>
        ) : autoPhase === "finished" ? (
          <p className="text-muted-foreground text-xs leading-snug">
            Remplissage terminé — les pièces justificatives (Phase C) et la
            décision (Phase D) restent manuelles.
          </p>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              onClick={onAutoStart}
              className="w-full text-xs"
            >
              <Wand2 className="size-3" />
              {autoPhase === "paused-picker"
                ? "Continuer le remplissage auto"
                : autoPhase === "error"
                  ? "Reprendre le remplissage auto"
                  : "Lancer le remplissage automatique"}
            </Button>
            <p className="text-muted-foreground text-[11px] leading-snug">
              {autoPhase === "paused-picker"
                ? "Sélectionnez un produit ci-contre, puis reprenez."
                : autoPhase === "error"
                  ? "L'exécution s'est arrêtée sur une erreur — corrigez l'étape ou reprenez avec de nouvelles données."
                  : "Exécute les étapes restantes avec des données aléatoires — dont les étapes facultatives cochées ci-dessous ; s'arrête au choix du produit et aux pièces justificatives."}
            </p>
          </>
        )}

        {/* Which optional steps the run must execute. Rendered in every auto
            phase (so the choice is visible while a run is in flight) but locked
            while the runner drives the steps. */}
        {mode === "auto" && optionalSteps.length > 0 && (
          <div className="border-border/60 space-y-1.5 rounded-md border p-2">
            <p className="text-muted-foreground text-[11px] font-medium">
              Étapes facultatives à exécuter
            </p>
            {optionalSteps.map((step) => {
              const inputId = `auto-optional-${step.id}`;
              return (
                <div key={step.id} className="flex items-start gap-2">
                  <Checkbox
                    id={inputId}
                    className="mt-px"
                    checked={selectedOptional.includes(step.id)}
                    disabled={disabled}
                    onCheckedChange={(c) => onToggleOptional(step.id, c === true)}
                  />
                  <Label
                    htmlFor={inputId}
                    className="text-muted-foreground text-[11px] leading-snug font-normal"
                  >
                    {shortTitle(step)}
                  </Label>
                </div>
              );
            })}
            <p className="text-muted-foreground text-[11px] leading-snug">
              Décochée, une étape facultative est marquée comme faite sans appel
              d&apos;API — comme « Passer ». Cochez-la puis relancez pour l&apos;exécuter.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

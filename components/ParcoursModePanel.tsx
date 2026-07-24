"use client";

import { Hand, ListChecks, Loader2, Square, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/Card";
import type { ParcoursMode } from "@/lib/parcours";

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

// Mode selector for the parcours + the launch/stop/resume controls of the fully
// automatic run. Purely presentational: the mode value and the runner lifecycle
// (aborts, state advancement) live in the page (see lib/parcours-auto.ts).
export default function ParcoursModePanel({
  mode,
  onModeChange,
  disabled,
  autoPhase,
  autoStepTitle,
  onAutoStart,
  onAutoStop,
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
                  : "Exécute les étapes restantes avec des données aléatoires ; s'arrête au choix du produit et aux pièces justificatives."}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

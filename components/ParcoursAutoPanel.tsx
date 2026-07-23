"use client";

import { Loader2, Square, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/Card";

// Status of the parcours auto-run, owned by app/parcours/page.tsx.
export type AutoPhase =
  | "idle"
  | "running"
  | "paused-picker"
  | "error"
  | "finished";

// Purely presentational: the launch/stop/resume controls + a one-line status
// for the « remplissage automatique » (see lib/parcours-auto.ts). All the
// logic (runner lifecycle, aborts, state advancement) lives in the page.
export default function ParcoursAutoPanel({
  phase,
  stepTitle,
  onStart,
  onStop,
}: {
  phase: AutoPhase;
  /** Title of the step currently executing (running phase only). */
  stepTitle?: string;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <Card>
      <CardBody className="space-y-2 p-3">
        {phase === "running" ? (
          <>
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <span className="min-w-0 flex-1 leading-snug">
                Exécution : {stepTitle ?? "…"}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onStop}
              className="w-full text-xs"
            >
              <Square className="size-3" /> Arrêter
            </Button>
          </>
        ) : phase === "finished" ? (
          <p className="text-muted-foreground text-xs leading-snug">
            Remplissage terminé — les pièces justificatives (Phase C) et la
            décision (Phase D) restent manuelles.
          </p>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              onClick={onStart}
              className="w-full text-xs"
            >
              <Wand2 className="size-3" />
              {phase === "paused-picker"
                ? "Continuer le remplissage auto"
                : phase === "error"
                  ? "Reprendre le remplissage auto"
                  : "Remplissage automatique"}
            </Button>
            <p className="text-muted-foreground text-[11px] leading-snug">
              {phase === "paused-picker"
                ? "Sélectionnez un produit ci-contre, puis reprenez."
                : phase === "error"
                  ? "L'exécution s'est arrêtée sur une erreur — corrigez l'étape ou reprenez avec de nouvelles données."
                  : "Exécute les étapes restantes avec des données aléatoires ; s'arrête au choix du produit et aux pièces justificatives."}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

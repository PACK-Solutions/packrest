"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Lock } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { apiTheme } from "@/lib/design";
import { cn } from "@/lib/utils";
import type { ParcoursDef, ParcoursStep } from "@/lib/parcours";

// The parcours rail: phases are collapsible and only the current phase is open
// by default, so the sidebar stays short. Done steps and the current step are
// selectable; steps further ahead are locked until the flow reaches them.
export default function ParcoursStepper({
  def,
  currentStepId,
  done,
  onSelect,
}: {
  def: ParcoursDef;
  currentStepId: string;
  done: string[];
  onSelect: (stepId: string) => void;
}) {
  const total = def.steps.length;
  const doneCount = done.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const currentPhase = def.steps.find((s) => s.id === currentStepId)?.phase;
  // The frontier: the first not-yet-done step. Always reachable so the user
  // can move forward again after clicking back onto an earlier (done) step.
  const frontierId = def.steps.find((s) => !done.includes(s.id))?.id;

  // Group steps by phase, preserving order.
  const phases: { phase: string; steps: ParcoursStep[] }[] = [];
  for (const step of def.steps) {
    const last = phases[phases.length - 1];
    if (last && last.phase === step.phase) last.steps.push(step);
    else phases.push({ phase: step.phase, steps: [step] });
  }

  // Open the current phase (and keep it open as the flow advances); other
  // phases collapse but can be peeked open by clicking their header.
  const [openPhases, setOpenPhases] = useState<Set<string>>(
    () => new Set(currentPhase ? [currentPhase] : []),
  );
  useEffect(() => {
    if (!currentPhase) return;
    setOpenPhases((prev) =>
      prev.has(currentPhase) ? prev : new Set(prev).add(currentPhase),
    );
  }, [currentPhase]);
  const togglePhase = (phase: string) =>
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });

  return (
    <nav aria-label="Étapes du parcours" className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>Progression</span>
          <span className="font-mono">
            {doneCount}/{total}
          </span>
        </div>
        <Progress value={pct} aria-label={`Progression : ${pct}%`} />
      </div>

      {phases.map((group) => {
        const open = openPhases.has(group.phase);
        const doneInPhase = group.steps.filter((s) =>
          done.includes(s.id),
        ).length;
        const hasCurrent = group.steps.some((s) => s.id === currentStepId);
        return (
          <div key={group.phase}>
            <button
              type="button"
              onClick={() => togglePhase(group.phase)}
              aria-expanded={open}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors",
                hasCurrent ? "text-foreground" : "text-muted-foreground",
                "hover:bg-sidebar-accent/50",
              )}
            >
              {open ? (
                <ChevronDown className="size-3.5 shrink-0" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 leading-snug">{group.phase}</span>
              <span className="shrink-0 font-mono text-[10px] font-normal">
                {doneInPhase}/{group.steps.length}
              </span>
            </button>
            {open && (
              <ol className="mt-0.5 space-y-0.5 pl-1">
                {group.steps.map((step) => {
                  const n = def.steps.indexOf(step) + 1;
                  const isDone = done.includes(step.id);
                  const isCurrent = step.id === currentStepId;
                  const selectable =
                    isDone || isCurrent || step.id === frontierId;
                  const theme = apiTheme(step.apiId);
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        disabled={!selectable}
                        onClick={() => selectable && onSelect(step.id)}
                        aria-current={isCurrent ? "step" : undefined}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                          isCurrent
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : selectable
                              ? "hover:bg-sidebar-accent/60"
                              : "cursor-not-allowed opacity-55",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                            isDone
                              ? "bg-emerald-500 text-white dark:bg-emerald-600"
                              : isCurrent
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {isDone ? (
                            <Check className="size-3" />
                          ) : !selectable ? (
                            <Lock className="size-3" />
                          ) : (
                            n
                          )}
                        </span>
                        <span
                          className={cn(
                            "inline-flex size-5 shrink-0 items-center justify-center rounded",
                            theme.bg,
                            theme.text,
                          )}
                        >
                          <theme.icon size={12} />
                        </span>
                        <span className="min-w-0 flex-1 leading-snug">
                          {step.title}
                        </span>
                        {step.optional && (
                          <span className="text-muted-foreground shrink-0 text-[10px] italic">
                            opt.
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </nav>
  );
}

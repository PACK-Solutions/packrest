"use client";

// Proactive update surface for both channels (application ← GitHub, contrats
// d'API ← GitLab). A single silent check per session feeds a small observable
// store, consumed by two hooks:
//   • useUpdateNotifier() — the passive dot on the "Paramètres" sidebar link
//     plus a one-shot sonner toast per new version.
//   • useUpdateOutcome()  — the full result, so the Settings card can show the
//     available version without a manual "Rechercher des mises à jour" click.
// The store re-checks the specs side on SPECS_CHANGED_EVENT, so a sync anywhere
// self-corrects the card and the dot without a page reload. Offline /
// browser-mode / unconfigured GitLab all degrade to "nothing available".

import { useEffect, useReducer } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { isTauri } from "@/lib/platform";
import { SPECS_CHANGED_EVENT } from "@/lib/specs";
import {
  getNotifiedAppVersion,
  setNotifiedAppVersion,
  getNotifiedSpecsTag,
  setNotifiedSpecsTag,
} from "@/lib/config";
import {
  checkForUpdates,
  checkSpecsUpdate,
  type UpdateCheckOutcome,
} from "@/lib/update-check";

// Give startup spec loading a head start before hitting the network.
const STARTUP_CHECK_DELAY_MS = 1500;

export interface UpdateAvailability {
  app: boolean;
  specs: boolean;
}

// --- observable store (module scope: one source of truth per session) -------

let outcome: UpdateCheckOutcome | null = null;
let checking = false;
let started = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

async function runCheck(): Promise<void> {
  if (checking) return;
  checking = true;
  emit();
  try {
    outcome = await checkForUpdates();
  } catch {
    /* best-effort — leave the previous outcome untouched */
  } finally {
    checking = false;
    emit();
  }
}

// Kick off the one automatic check per session (delayed, Tauri-only).
function ensureStarted(): void {
  if (started || !isTauri()) return;
  started = true;
  window.setTimeout(() => {
    void runCheck();
  }, STARTUP_CHECK_DELAY_MS);
}

// Manual, immediate re-check (the Settings button).
export function recheckUpdates(): Promise<void> {
  return runCheck();
}

// Re-evaluate only the specs side (after a sync clears/changes the loaded tag).
async function refreshSpecs(): Promise<void> {
  if (!outcome) return;
  try {
    const specs = await checkSpecsUpdate();
    outcome = { ...outcome, specs };
    emit();
  } catch {
    /* keep the previous specs state */
  }
}

// Single window subscription for the whole session — fires after any sync
// (SPECS_CHANGED_EVENT is dispatched once a sync busts the spec cache).
if (typeof window !== "undefined") {
  window.addEventListener(SPECS_CHANGED_EVENT, () => {
    void refreshSpecs();
  });
}

// --- toast (one per new version, de-duped against the persisted slots) ------

// Toast action: a real Next <Link> (rendered inside <Toaster>, so it keeps the
// router context) rather than an imperative router.push — the anchor-based soft
// navigation is the one that works in the packaged Tauri webview, where
// router.push() from a portaled toast does not. Tapping it also dismisses the
// originating toast (soft nav keeps the SPA — and the toast — mounted).
function settingsAction(toastId: string) {
  return (
    <Link
      href="/settings"
      onClick={() => toast.dismiss(toastId)}
      className="bg-primary text-primary-foreground inline-flex shrink-0 items-center rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap"
    >
      Voir
    </Link>
  );
}

async function notify(current: UpdateCheckOutcome): Promise<void> {
  if (current.app) {
    const { latest, currentVersion } = current.app;
    if ((await getNotifiedAppVersion()) !== latest.tag) {
      await setNotifiedAppVersion(latest.tag);
      const id = "packrest-update-app";
      toast.info("Mise à jour de PackRest disponible", {
        id,
        description: `Version ${latest.tag} — vous utilisez v${currentVersion}.`,
        action: settingsAction(id),
        duration: 10000,
      });
    }
  }
  if (current.specs) {
    const { latestTag, currentTag } = current.specs;
    if ((await getNotifiedSpecsTag()) !== latestTag) {
      await setNotifiedSpecsTag(latestTag);
      const id = "packrest-update-specs";
      toast.info("Nouveaux contrats d'API disponibles", {
        id,
        description: `Release ${latestTag} publiée sur GitLab (chargée : ${currentTag}).`,
        action: settingsAction(id),
        duration: 10000,
      });
    }
  }
}

// --- hooks ------------------------------------------------------------------

export interface UpdateOutcome {
  outcome: UpdateCheckOutcome | null;
  checking: boolean;
  recheck: () => Promise<void>;
}

// Subscribe to the shared store and trigger the one-per-session auto-check.
export function useUpdateOutcome(): UpdateOutcome {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    ensureStarted();
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  return { outcome, checking, recheck: recheckUpdates };
}

// The passive sidebar dot + a one-shot toast per new version.
export function useUpdateNotifier(): UpdateAvailability {
  const { outcome: current } = useUpdateOutcome();
  useEffect(() => {
    if (current) void notify(current);
  }, [current]);
  return { app: Boolean(current?.app), specs: Boolean(current?.specs) };
}

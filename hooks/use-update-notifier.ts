"use client";

// Proactive update notifications: one silent check per session, shortly after
// startup, covering both channels (application ← GitHub, contrats d'API ←
// GitLab). Each available update fires a sonner toast at most once per new
// version (persisted in the store), while the returned flags stay true until
// the user actually updates/syncs — they drive the passive dot on the
// "Paramètres" sidebar link. Offline / browser-mode / unconfigured GitLab all
// degrade to "no notification", never an error.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

// One check per app session; also lets the flags survive AppShell remounts.
let sessionOutcome: UpdateCheckOutcome | null = null;

export interface UpdateAvailability {
  app: boolean;
  specs: boolean;
}

export function useUpdateNotifier(): UpdateAvailability {
  const router = useRouter();
  const [available, setAvailable] = useState<UpdateAvailability>({
    app: false,
    specs: false,
  });

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    const apply = (outcome: UpdateCheckOutcome) => {
      if (cancelled) return;
      setAvailable({ app: Boolean(outcome.app), specs: Boolean(outcome.specs) });
    };

    const notify = async (outcome: UpdateCheckOutcome) => {
      const goToSettings = {
        label: "Voir",
        onClick: () => router.push("/settings"),
      };
      if (outcome.app) {
        const { latest, currentVersion } = outcome.app;
        if ((await getNotifiedAppVersion()) !== latest.tag) {
          await setNotifiedAppVersion(latest.tag);
          toast.info("Mise à jour de PackRest disponible", {
            description: `Version ${latest.tag} — vous utilisez v${currentVersion}.`,
            action: goToSettings,
            duration: 10000,
          });
        }
      }
      if (outcome.specs) {
        const { latestTag, currentTag } = outcome.specs;
        if ((await getNotifiedSpecsTag()) !== latestTag) {
          await setNotifiedSpecsTag(latestTag);
          toast.info("Nouveaux contrats d'API disponibles", {
            description: `Release ${latestTag} publiée sur GitLab (chargée : ${currentTag}).`,
            action: goToSettings,
            duration: 10000,
          });
        }
      }
    };

    let timer: number | undefined;
    if (sessionOutcome) {
      apply(sessionOutcome);
    } else {
      timer = window.setTimeout(() => {
        checkForUpdates()
          .then(async (outcome) => {
            sessionOutcome = outcome;
            apply(outcome);
            await notify(outcome);
          })
          .catch(() => {
            /* startup check is best-effort — stay silent */
          });
      }, STARTUP_CHECK_DELAY_MS);
    }

    // After any sync, re-evaluate the specs side so syncing the new tag
    // clears the dot without a restart (and a sync to an older tag re-arms it).
    const onSpecsChanged = () => {
      checkSpecsUpdate()
        .then((specs) => {
          if (sessionOutcome) sessionOutcome = { ...sessionOutcome, specs };
          if (!cancelled) {
            setAvailable((prev) => ({ ...prev, specs: Boolean(specs) }));
          }
        })
        .catch(() => {
          /* ignore — keep the previous flag */
        });
    };
    window.addEventListener(SPECS_CHANGED_EVENT, onSpecsChanged);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener(SPECS_CHANGED_EVENT, onSpecsChanged);
    };
  }, [router]);

  return available;
}

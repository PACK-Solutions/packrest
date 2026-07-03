// Unified "is something newer available?" check for the two independent
// update channels: the application itself (GitHub Releases, manual installer)
// and the OpenAPI contracts (GitLab release bundles, in-app sync). Pure logic
// — no React, no toasts; consumed by the startup notifier hook and the
// Settings "Mises à jour" card.

import { getLatestRelease, compareVersions, type LatestRelease } from "./github";
import { listReleases } from "./gitlab";
import { getAppVersion } from "./app-version";
import { getSpecsTag, getGitlabConfigPublic } from "./config";

export interface AppUpdate {
  currentVersion: string;
  latest: LatestRelease;
}

export interface SpecsUpdate {
  currentTag: string;
  latestTag: string;
  latestReleasedAt?: string;
}

export interface UpdateCheckOutcome {
  /** Newer app release, or null when up to date. */
  app: AppUpdate | null;
  /** Newer specs release, or null when up to date or not applicable. */
  specs: SpecsUpdate | null;
  appError: string | null;
  specsError: string | null;
}

// The newest GitLab release may not carry a bundle.zip (e.g. a docs-only
// release); look a few releases back for the newest one that does.
const SPECS_RELEASES_LOOKBACK = 5;

/** Latest GitHub release when it is newer than the running app, else null. */
export async function checkAppUpdate(): Promise<AppUpdate | null> {
  const [latest, currentVersion] = await Promise.all([
    getLatestRelease(),
    getAppVersion(),
  ]);
  return compareVersions(latest.tag, currentVersion) > 0
    ? { currentVersion, latest }
    : null;
}

/**
 * Newest bundle-bearing GitLab release differing from the loaded specs tag.
 * Not applicable (returns null without a network call) when the loaded specs
 * are local (no SpecsTag) or when no GitLab token is stored.
 */
export async function checkSpecsUpdate(): Promise<SpecsUpdate | null> {
  const [specsTag, gitlab] = await Promise.all([
    getSpecsTag(),
    getGitlabConfigPublic(),
  ]);
  if (!specsTag || !gitlab.hasToken) return null;
  const { releases } = await listReleases(SPECS_RELEASES_LOOKBACK);
  // Releases come newest-first, so the first bundle-bearing one is the newest
  // syncable release. Tags aren't guaranteed semver — plain inequality is the
  // comparison; "different from what's loaded" is what matters.
  const latest = releases.find((r) => r.hasBundle);
  if (!latest || latest.tag === specsTag.tag) return null;
  return {
    currentTag: specsTag.tag,
    latestTag: latest.tag,
    latestReleasedAt: latest.releasedAt,
  };
}

/** Both checks in parallel; failures are captured as messages, never thrown. */
export async function checkForUpdates(): Promise<UpdateCheckOutcome> {
  const [app, specs] = await Promise.allSettled([
    checkAppUpdate(),
    checkSpecsUpdate(),
  ]);
  return {
    app: app.status === "fulfilled" ? app.value : null,
    specs: specs.status === "fulfilled" ? specs.value : null,
    appError: app.status === "rejected" ? String(app.reason?.message ?? app.reason) : null,
    specsError:
      specs.status === "rejected" ? String(specs.reason?.message ?? specs.reason) : null,
  };
}

// GitHub release check for the in-app updater, client-side. Queries the public
// Releases API of the app repo via the Tauri HTTP plugin (no CORS; a custom
// User-Agent is required by GitHub and allowed by the `unsafe-headers` feature)
// and exposes helpers to compare versions and pick the right installer asset.
// The actual download URL is opened in the system browser (see lib/opener.ts) —
// the lightweight update path, no auto-install.

import { tauriFetch } from "./net";

// Repo that publishes the desktop installers (see .github/workflows/build.yml).
export const GITHUB_REPO = "PACK-Solutions/packrest";

export class GithubError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "GithubError";
    this.status = status;
  }
}

export interface ReleaseAsset {
  name: string;
  /** browser_download_url — opened externally, never fetched here. */
  url: string;
}

export interface LatestRelease {
  tag: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt?: string;
  assets: ReleaseAsset[];
}

interface GithubReleaseJson {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

export async function getLatestRelease(): Promise<LatestRelease> {
  let res: Response;
  try {
    res = await tauriFetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "PackRest",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  } catch (e) {
    throw new GithubError(
      `Impossible de contacter GitHub : ${(e as Error).message}`,
      502,
    );
  }
  if (res.status === 404) {
    throw new GithubError("Aucune release publiée sur GitHub.", 404);
  }
  if (!res.ok) {
    throw new GithubError(
      `Vérification des mises à jour impossible (HTTP ${res.status}).`,
      res.status >= 500 ? 502 : 400,
    );
  }
  const data = (await res.json()) as GithubReleaseJson;
  const tag = data.tag_name ?? "";
  if (!tag) {
    throw new GithubError("Release GitHub sans tag exploitable.", 502);
  }
  return {
    tag,
    name: data.name?.trim() || tag,
    body: data.body ?? "",
    htmlUrl:
      data.html_url ?? `https://github.com/${GITHUB_REPO}/releases/latest`,
    publishedAt: data.published_at,
    assets: (data.assets ?? [])
      .filter((a) => a.name && a.browser_download_url)
      .map((a) => ({ name: a.name!, url: a.browser_download_url! })),
  };
}

// Numeric dotted compare, tolerant of a leading `v` and pre-release suffixes
// (e.g. `1.2.0-rc1` compares as `1.2.0`). Returns >0 when `a` is newer than
// `b`, <0 when older, 0 when equal.
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((p) => parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Pick the installer asset matching the current OS: `.dmg` on macOS, the NSIS
// `-setup.exe` (else any `.exe`) on Windows. Returns null when nothing matches,
// so the caller can fall back to the release page.
export function pickInstallerAsset(
  assets: ReleaseAsset[],
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): ReleaseAsset | null {
  const isMac = /Mac/i.test(ua);
  const isWin = /Win/i.test(ua);
  if (isMac) {
    return assets.find((a) => /\.dmg$/i.test(a.name)) ?? null;
  }
  if (isWin) {
    return (
      assets.find((a) => /-setup\.exe$/i.test(a.name)) ??
      assets.find((a) => /\.exe$/i.test(a.name)) ??
      null
    );
  }
  return null;
}

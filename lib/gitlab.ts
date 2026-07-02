// GitLab release source, client-side. Downloads the `bundle.zip` asset of a
// chosen release via the Tauri HTTP plugin (PRIVATE-TOKEN header, no CORS),
// unzips it in the browser with fflate, and writes each OpenAPI bundle into
// the writable app-data spec store. Formerly a set of server routes; the
// asset-matching, layout tolerance and spec-diff logic are reused unchanged.

import { unzipSync } from "fflate";
import { diffSpec, type SpecDiff } from "./spec-diff";
import {
  getGitlabConfig,
  GITLAB_DEFAULT_HOST,
  GITLAB_DEFAULT_PROJECT,
} from "./config";
import { readSpecFile, writeSpecFile } from "./specs-fs";
import { resetSpecCache } from "./specs";
import { tauriFetch } from "./net";

// Surfaced to the UI with an HTTP-ish status so it can show a useful message.
export class GitlabError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "GitlabError";
    this.status = status;
  }
}

interface ResolvedGitlab {
  host: string;
  projectPath: string;
  token: string;
}

export interface ReleaseSummary {
  tag: string;
  name: string;
  releasedAt?: string;
  /** True when the release exposes a downloadable bundle.zip asset. */
  hasBundle: boolean;
}

export interface ReleaseListResult {
  releases: ReleaseSummary[];
  /** Total releases on the project, or null when GitLab omits the count. */
  total: number | null;
  /** Another page exists beyond what was returned. */
  hasMore: boolean;
}

export interface GitlabSyncResult {
  tag: string;
  bundleName: string;
  copied: string[];
  skipped: string[];
  /** Per-API structural diff vs the previously-synced bundles. */
  diffs: SpecDiff[];
}

async function resolveGitlab(): Promise<ResolvedGitlab> {
  const g = await getGitlabConfig();
  const token = (g.token ?? "").trim();
  if (!token) {
    throw new GitlabError(
      "Token GitLab non configuré. Renseignez-le dans Paramètres → Source GitLab.",
      400,
    );
  }
  return {
    host: (g.host?.trim() || GITLAB_DEFAULT_HOST).replace(/\/+$/, ""),
    projectPath: g.projectPath?.trim() || GITLAB_DEFAULT_PROJECT,
    token,
  };
}

function projectApiBase(g: ResolvedGitlab): string {
  // Encode so `group/project` becomes `group%2Fproject`; a numeric id passes
  // through unchanged.
  return `${g.host}/api/v4/projects/${encodeURIComponent(g.projectPath)}`;
}

function gitlabFetch(url: string, token: string): Promise<Response> {
  return tauriFetch(url, { headers: { "PRIVATE-TOKEN": token } });
}

async function toError(res: Response, fallback: string): Promise<GitlabError> {
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    detail = body.message || body.error || "";
  } catch {
    /* non-JSON body — fall back to status only */
  }
  const msg = detail
    ? `${fallback} (HTTP ${res.status} : ${detail})`
    : `${fallback} (HTTP ${res.status})`;
  const status =
    res.status === 401 || res.status === 403
      ? res.status
      : res.status >= 500
        ? 502
        : 400;
  return new GitlabError(msg, status);
}

interface AssetLink {
  name?: string;
  url?: string;
  direct_asset_url?: string;
}

// Locate the bundle.zip asset link. Prefer an exact name match, then any
// link whose URL ends in bundle.zip. Returns the candidate download URLs in
// priority order (the registered url, then the release-permalink form).
function findBundleLink(release: {
  assets?: { links?: AssetLink[] };
}): { name: string; urls: string[] } | null {
  const links = release.assets?.links ?? [];
  const pick = (l: AssetLink) => ({
    name: l.name ?? "bundle.zip",
    urls: [l.url, l.direct_asset_url].filter(
      (u): u is string => typeof u === "string" && u.length > 0,
    ),
  });
  const byName = links.find(
    (l) => typeof l.name === "string" && l.name.toLowerCase() === "bundle.zip",
  );
  if (byName) return pick(byName);
  const byUrl = links.find((l) =>
    /bundle\.zip(?:\?|$)/i.test(l.direct_asset_url || l.url || ""),
  );
  return byUrl ? pick(byUrl) : null;
}

// GitLab returns releases newest-first. `limit` caps the page size so the UI
// can preview just the latest few; omit (or pass <=0) to fetch up to 100.
export async function listReleases(limit?: number): Promise<ReleaseListResult> {
  const g = await resolveGitlab();
  const perPage = limit && limit > 0 ? Math.min(limit, 100) : 100;
  const res = await gitlabFetch(
    `${projectApiBase(g)}/releases?per_page=${perPage}`,
    g.token,
  );
  if (!res.ok) throw await toError(res, "Impossible de lister les releases");
  const data = (await res.json()) as Array<{
    tag_name: string;
    name?: string;
    released_at?: string;
    assets?: { links?: AssetLink[] };
  }>;
  const totalHeader = res.headers.get("x-total");
  const total =
    totalHeader && /^\d+$/.test(totalHeader) ? Number(totalHeader) : null;
  const hasMore =
    Boolean(res.headers.get("x-next-page")?.trim()) ||
    (total != null && total > data.length);
  return {
    total,
    hasMore,
    releases: data.map((r) => ({
      tag: r.tag_name,
      name: r.name?.trim() || r.tag_name,
      releasedAt: r.released_at,
      hasBundle: findBundleLink(r) != null,
    })),
  };
}

export async function syncFromGitlab(tag: string): Promise<GitlabSyncResult> {
  const g = await resolveGitlab();
  const relRes = await gitlabFetch(
    `${projectApiBase(g)}/releases/${encodeURIComponent(tag)}`,
    g.token,
  );
  if (!relRes.ok) throw await toError(relRes, `Release introuvable : ${tag}`);
  const release = (await relRes.json()) as {
    assets?: { links?: AssetLink[] };
  };

  const bundle = findBundleLink(release);
  if (!bundle) {
    const names =
      (release.assets?.links ?? [])
        .map((l) => l.name)
        .filter(Boolean)
        .join(", ") || "(aucun)";
    throw new GitlabError(
      `Aucun asset « bundle.zip » dans la release ${tag}. Assets disponibles : ${names}`,
      404,
    );
  }

  let buf: ArrayBuffer | null = null;
  let lastStatus = 0;
  for (const url of bundle.urls) {
    const res = await gitlabFetch(url, g.token);
    if (res.ok) {
      buf = await res.arrayBuffer();
      break;
    }
    lastStatus = res.status;
  }
  if (!buf) {
    throw new GitlabError(
      `Échec du téléchargement de ${bundle.name} (HTTP ${lastStatus}).`,
      502,
    );
  }

  return extractBundle(tag, bundle.name, new Uint8Array(buf));
}

// Pull every OpenAPI bundle out of the zip and write it into the spec store.
// Tolerant of two layouts: the nested `<api>/v1/openapi.bundle.yaml` mirror of
// the local specs tree, and a flat set of `<api>.yaml` files. Nested matches
// win when both are present.
async function extractBundle(
  tag: string,
  bundleName: string,
  zipped: Uint8Array,
): Promise<GitlabSyncResult> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipped);
  } catch (err) {
    throw new GitlabError(
      `Archive ${bundleName} illisible : ${(err as Error).message}`,
      502,
    );
  }

  const NESTED = /(?:^|\/)([^/]+)\/v1\/openapi\.bundle\.ya?ml$/i;
  const FLAT = /^([^/]+)\.ya?ml$/i;
  const picked = new Map<string, { content: Uint8Array; priority: number }>();
  const decoder = new TextDecoder();

  for (const [entry, content] of Object.entries(files)) {
    if (entry.endsWith("/")) continue; // directory record
    const nested = NESTED.exec(entry);
    const flat = nested ? null : FLAT.exec(entry);
    const match = nested ?? flat;
    if (!match) continue;
    const api = match[1];
    if (api === "." || api === "..") continue;
    const priority = nested ? 2 : 1;
    const existing = picked.get(api);
    if (!existing || priority > existing.priority) {
      picked.set(api, { content, priority });
    }
  }

  const copied: string[] = [];
  const diffs: SpecDiff[] = [];
  for (const [api, { content }] of picked) {
    const decoded = decoder.decode(content);
    const previous = await readSpecFile(api);
    await writeSpecFile(api, decoded);
    copied.push(api);
    diffs.push(diffSpec(api, previous, decoded));
  }
  copied.sort();
  diffs.sort((a, b) => a.api.localeCompare(b.api));

  if (copied.length === 0) {
    throw new GitlabError(
      `${bundleName} ne contient aucun fichier OpenAPI reconnu ` +
        `(attendu <api>/v1/openapi.bundle.yaml ou <api>.yaml).`,
      422,
    );
  }

  resetSpecCache();
  return { tag, bundleName, copied, skipped: [], diffs };
}

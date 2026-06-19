import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { loadConfig, saveConfig, type GitlabConfig } from "./sync";

// Server-side GitLab release source. Downloads the `bundle.zip` asset of a
// chosen release, unzips it in memory, and writes each OpenAPI bundle into
// public/specs/<api>.yaml — the same destination scripts/copy-specs.mjs
// targets, so the rest of the app is unaware of where the specs came from.
//
// The access token lives in .packrest.config.json (gitignored). It never
// reaches the browser: every fetch here is server-to-GitLab with a
// PRIVATE-TOKEN header.

const DEST = path.join(process.cwd(), "public", "specs");

const DEFAULT_HOST = "https://gitlab.com";
const DEFAULT_PROJECT = "packsolutions/openapi";

// Surfaced to the route with an HTTP status so the UI gets a useful message.
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

export interface GitlabConfigPublic {
  host: string;
  projectPath: string;
  /** Whether a token is stored. The token value itself is never returned. */
  hasToken: boolean;
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
}

export async function loadGitlabConfig(): Promise<GitlabConfig> {
  const { config } = await loadConfig();
  return config.gitlab ?? {};
}

export async function getGitlabConfigPublic(): Promise<GitlabConfigPublic> {
  const g = await loadGitlabConfig();
  return {
    host: g.host?.trim() || DEFAULT_HOST,
    projectPath: g.projectPath?.trim() || DEFAULT_PROJECT,
    hasToken: Boolean(g.token && g.token.trim()),
  };
}

// Merge a partial config in. `token` is only overwritten when a non-empty
// value is supplied, so the UI can leave the masked field blank to keep the
// existing token. host/projectPath clear back to their defaults when blanked.
export async function saveGitlabConfig(
  patch: GitlabConfig,
): Promise<GitlabConfigPublic> {
  const { config } = await loadConfig();
  const next: GitlabConfig = { ...(config.gitlab ?? {}) };
  if (patch.host !== undefined) next.host = patch.host.trim() || undefined;
  if (patch.projectPath !== undefined)
    next.projectPath = patch.projectPath.trim() || undefined;
  if (patch.token !== undefined && patch.token.trim())
    next.token = patch.token.trim();
  await saveConfig({ ...config, gitlab: next });
  return getGitlabConfigPublic();
}

async function resolveGitlab(): Promise<ResolvedGitlab> {
  const g = await loadGitlabConfig();
  const token = (g.token ?? "").trim();
  if (!token) {
    throw new GitlabError(
      "Token GitLab non configuré. Renseignez-le dans Paramètres → Source GitLab.",
      400,
    );
  }
  return {
    host: (g.host?.trim() || DEFAULT_HOST).replace(/\/+$/, ""),
    projectPath: g.projectPath?.trim() || DEFAULT_PROJECT,
    token,
  };
}

function projectApiBase(g: ResolvedGitlab): string {
  // Encode so `group/project` becomes `group%2Fproject`; a numeric id passes
  // through unchanged.
  return `${g.host}/api/v4/projects/${encodeURIComponent(g.projectPath)}`;
}

function gitlabFetch(url: string, token: string): Promise<Response> {
  return fetch(url, { headers: { "PRIVATE-TOKEN": token } });
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
  // 401/403 are the user's problem (bad/expired token); 5xx are GitLab's.
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
  const total = totalHeader && /^\d+$/.test(totalHeader)
    ? Number(totalHeader)
    : null;
  // X-Next-Page is the most reliable "more exist" signal; some endpoints omit
  // X-Total. Fall back to comparing the count against the requested page size.
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
    // fetch follows GitLab's redirect to object storage; the PRIVATE-TOKEN
    // header is dropped cross-origin, which is correct — that URL is
    // pre-signed.
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

// Pull every OpenAPI bundle out of the zip and write public/specs/<api>.yaml.
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
  // api id -> { content, priority }. Nested layout (2) beats flat (1).
  const picked = new Map<string, { content: Uint8Array; priority: number }>();
  const decoder = new TextDecoder();

  for (const [entry, content] of Object.entries(files)) {
    if (entry.endsWith("/")) continue; // directory record
    const nested = NESTED.exec(entry);
    const flat = nested ? null : FLAT.exec(entry);
    const match = nested ?? flat;
    if (!match) continue;
    const api = match[1];
    if (api === "." || api === "..") continue; // never write outside DEST
    const priority = nested ? 2 : 1;
    const existing = picked.get(api);
    if (!existing || priority > existing.priority) {
      picked.set(api, { content, priority });
    }
  }

  await fs.mkdir(DEST, { recursive: true });
  const copied: string[] = [];
  for (const [api, { content }] of picked) {
    await fs.writeFile(path.join(DEST, `${api}.yaml`), decoder.decode(content));
    copied.push(api);
  }
  copied.sort();

  if (copied.length === 0) {
    throw new GitlabError(
      `${bundleName} ne contient aucun fichier OpenAPI reconnu ` +
        `(attendu <api>/v1/openapi.bundle.yaml ou <api>.yaml).`,
      422,
    );
  }

  return { tag, bundleName, copied, skipped: [] };
}

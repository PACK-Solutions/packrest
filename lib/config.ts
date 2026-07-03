// App configuration that used to live server-side in .packrest.config.json:
// the local spec source directory and the GitLab release source. Now stored
// in tauri-plugin-store (localStorage fallback outside Tauri). The GitLab
// access token is kept here too — same protection level as the previous
// gitignored file, but persisted per-user in the app-data store.

import { storeGet, storeSet, storeDelete } from "./store";

export interface GitlabConfig {
  /** GitLab instance origin, e.g. https://gitlab.com. */
  host?: string;
  /** Project path (`group/project`) or numeric id. */
  projectPath?: string;
  /** Access token with read_api scope. */
  token?: string;
}

export interface GitlabConfigPublic {
  host: string;
  projectPath: string;
  /** Whether a token is stored. The token value itself is never surfaced. */
  hasToken: boolean;
}

export const GITLAB_DEFAULT_HOST = "https://gitlab.com";
export const GITLAB_DEFAULT_PROJECT = "packsolutions/openapi";

const KEY_SPECS_DIR = "packrest.specsDir";
const KEY_GITLAB = "packrest.gitlab";
const KEY_SPECS_TAG = "packrest.specsTag";

// Which GitLab release the currently-loaded specs came from. Persisted after a
// successful `syncFromGitlab` (the tag was previously discarded), and cleared
// on a local-directory sync since those bundles have no release tag.
export interface SpecsTag {
  tag: string;
  releasedAt?: string;
  /** ISO timestamp of when the sync happened. */
  syncedAt: string;
}

export async function getSpecsTag(): Promise<SpecsTag | null> {
  return (await storeGet<SpecsTag>(KEY_SPECS_TAG)) ?? null;
}
export async function setSpecsTag(value: SpecsTag): Promise<void> {
  await storeSet(KEY_SPECS_TAG, value);
}
export async function clearSpecsTag(): Promise<void> {
  await storeDelete(KEY_SPECS_TAG);
}

export async function getSpecsDir(): Promise<string> {
  return (await storeGet<string>(KEY_SPECS_DIR)) ?? "";
}
export async function setSpecsDir(dir: string): Promise<void> {
  await storeSet(KEY_SPECS_DIR, dir.trim());
}

export async function getGitlabConfig(): Promise<GitlabConfig> {
  return (await storeGet<GitlabConfig>(KEY_GITLAB)) ?? {};
}

export async function getGitlabConfigPublic(): Promise<GitlabConfigPublic> {
  const g = await getGitlabConfig();
  return {
    host: g.host?.trim() || GITLAB_DEFAULT_HOST,
    projectPath: g.projectPath?.trim() || GITLAB_DEFAULT_PROJECT,
    hasToken: Boolean(g.token && g.token.trim()),
  };
}

// Merge a partial config in. `token` is only overwritten when a non-empty
// value is supplied, so the UI can leave the field blank to keep the existing
// token. host/projectPath clear back to their defaults when blanked.
export async function saveGitlabConfig(
  patch: GitlabConfig,
): Promise<GitlabConfigPublic> {
  const cur = await getGitlabConfig();
  const next: GitlabConfig = { ...cur };
  if (patch.host !== undefined) next.host = patch.host.trim() || undefined;
  if (patch.projectPath !== undefined)
    next.projectPath = patch.projectPath.trim() || undefined;
  if (patch.token !== undefined && patch.token.trim())
    next.token = patch.token.trim();
  await storeSet(KEY_GITLAB, next);
  return getGitlabConfigPublic();
}

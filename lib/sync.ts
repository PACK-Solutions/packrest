import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import constants from "./sync-constants.json";
import { diffSpec, type SpecDiff } from "./spec-diff";

// Server-side mirror of scripts/copy-specs.mjs. Shared constants live in
// sync-constants.json so both this module and the CLI agree on env var
// name, config filename, and default source path. The CLI runs under
// plain `node` and can't import TS, so the copy/resolve logic is
// duplicated — but the strings can't drift.

const { ENV_VAR_NAME, CONFIG_FILENAME, DEFAULT_RELATIVE_PARTS, EXCLUDED_APIS } =
  constants;

const REPO_ROOT = process.cwd();
const DEST = path.join(REPO_ROOT, "public", "specs");
export const CONFIG_FILE = path.join(REPO_ROOT, CONFIG_FILENAME);
const DEFAULT_SOURCE = path.resolve(REPO_ROOT, ...DEFAULT_RELATIVE_PARTS);

// Paths the user is never allowed to set as specsDir. They're checked
// against the *resolved* path (post path.resolve), so relative tricks
// like ../../ end up here too.
const FORBIDDEN_PREFIXES = [
  "/etc",
  "/var",
  "/usr",
  "/bin",
  "/sbin",
  "/boot",
  "/sys",
  "/proc",
  "/dev",
  "/root",
  "/private/etc",
  "/private/var",
  "/Library",
  "/System",
  "/Applications",
];

// Reject resolved paths that point at system roots. We're not trying to
// stop a determined attacker with shell access (they already won) — we
// stop the XSS-induced "POST /api/config with specsDir=/etc" path.
export function isForbiddenSpecsDir(resolved: string): string | null {
  if (resolved === "/" || resolved === "" || resolved === os.homedir()) {
    return "Le dossier doit être un sous-dossier dédié aux specs.";
  }
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + path.sep)) {
      return `Chemin système refusé (${prefix}). Choisissez un dossier projet.`;
    }
  }
  return null;
}

// GitLab release source (alternative to a local specsDir). The token is a
// Personal/Project Access Token with `read_api` scope. It's stored here —
// in the gitignored .packrest.config.json — and never sent to the browser:
// /api/gitlab masks it on GET and the download runs server-side.
export interface GitlabConfig {
  /** GitLab instance origin, e.g. https://gitlab.com. */
  host?: string;
  /** Project path (`group/project`) or numeric id. */
  projectPath?: string;
  /** Access token with read_api scope. */
  token?: string;
}

export interface PackrestConfig {
  specsDir?: string;
  gitlab?: GitlabConfig;
}

export interface ConfigLoadResult {
  config: PackrestConfig;
  /** Set when the file existed but couldn't be parsed/used. Missing file is not an error. */
  error?: string;
}

export async function loadConfig(): Promise<ConfigLoadResult> {
  let raw: string;
  try {
    raw = await fs.readFile(CONFIG_FILE, "utf8");
  } catch {
    return { config: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      config: {},
      error: `Malformed JSON in ${CONFIG_FILENAME}: ${(err as Error).message}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      config: {},
      error: `${CONFIG_FILENAME} must contain a JSON object`,
    };
  }
  return { config: parsed as PackrestConfig };
}

export async function saveConfig(cfg: PackrestConfig): Promise<void> {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export async function resolveSpecsDir(): Promise<string> {
  const { config } = await loadConfig();
  if (config.specsDir && config.specsDir.trim()) {
    return path.resolve(config.specsDir);
  }
  const env = process.env[ENV_VAR_NAME];
  if (env && env.trim()) return path.resolve(env);
  return DEFAULT_SOURCE;
}

export interface SyncResult {
  source: string;
  dest: string;
  copied: string[];
  skipped: string[];
  missing: boolean;
  /** Per-API structural diff vs the previously-synced bundles. */
  diffs: SpecDiff[];
}

// Serialises concurrent calls: a second click while a sync is in flight
// gets the in-flight promise's result, not a parallel copy that interleaves
// file writes.
let inFlightSync: Promise<SyncResult> | null = null;

export function copySpecs(specsDir?: string): Promise<SyncResult> {
  if (inFlightSync) return inFlightSync;
  inFlightSync = doCopy(specsDir).finally(() => {
    inFlightSync = null;
  });
  return inFlightSync;
}

async function doCopy(specsDir?: string): Promise<SyncResult> {
  const source = specsDir ?? (await resolveSpecsDir());
  // Symlink hardening: resolve to a real path and re-check against the
  // forbidden-prefix list. Without this, an attacker who set specsDir to
  // a "safe" path could point a symlink inside at /etc and have us copy
  // /etc/foo into public/specs/foo.yaml.
  let realSource: string;
  try {
    realSource = await fs.realpath(source);
  } catch {
    return { source, dest: DEST, copied: [], skipped: [], missing: true, diffs: [] };
  }
  if (isForbiddenSpecsDir(realSource)) {
    return { source, dest: DEST, copied: [], skipped: [], missing: true, diffs: [] };
  }
  let entries;
  try {
    entries = await fs.readdir(realSource, { withFileTypes: true });
  } catch {
    return { source, dest: DEST, copied: [], skipped: [], missing: true, diffs: [] };
  }
  await fs.mkdir(DEST, { recursive: true });
  const apis = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    // Deprecated / merged APIs are never copied (e.g. payment-method, whose
    // endpoints moved into person).
    .filter((name) => !EXCLUDED_APIS.includes(name));
  const copied: string[] = [];
  const skipped: string[] = [];
  const diffs: SpecDiff[] = [];
  for (const api of apis) {
    // API folder names come from readdir — they shouldn't contain path
    // separators, but if a symlink shenanigan brought one in, refuse it.
    if (api.includes("/") || api.includes("\\") || api === ".." || api === ".") {
      skipped.push(api);
      continue;
    }
    const src = path.join(realSource, api, "v1", "openapi.bundle.yaml");
    try {
      // Verify the bundle's *real* path is still under our source — blocks
      // a symlink api/ -> /etc trick from escaping the source tree.
      const realSrc = await fs.realpath(src);
      if (
        realSrc !== realSource + path.sep + api + path.sep + "v1" + path.sep + "openapi.bundle.yaml" &&
        !realSrc.startsWith(realSource + path.sep)
      ) {
        skipped.push(api);
        continue;
      }
      const content = await fs.readFile(realSrc, "utf8");
      const destFile = path.join(DEST, `${api}.yaml`);
      // Capture the previously-synced bundle before overwriting so we can
      // report what moved. Missing file → null → the API reads as "added".
      const previous = await fs.readFile(destFile, "utf8").catch(() => null);
      await fs.writeFile(destFile, content);
      copied.push(api);
      diffs.push(diffSpec(api, previous, content));
    } catch {
      skipped.push(api);
    }
  }
  return {
    source: realSource,
    dest: DEST,
    copied,
    skipped,
    missing: false,
    diffs,
  };
}

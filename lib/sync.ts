// Local-directory spec sync, client-side. Formerly a server route
// (node:fs copy of <src>/<api>/v1/openapi.bundle.yaml → public/specs). Now the
// Rust `read_source_specs` command reads the user-picked source directory and
// the bundles are written into the writable app-data spec store via
// tauri-plugin-fs. The pure spec-diff logic is reused unchanged.

import { diffSpec, type SpecDiff } from "./spec-diff";
import { readSpecFile, writeSpecFile } from "./specs-fs";
import { resetSpecCache } from "./specs";
import { getSpecsDir, clearSpecsTag } from "./config";
import { isTauri } from "./platform";
import constants from "./sync-constants.json";

const { EXCLUDED_APIS } = constants;

export interface SyncResult {
  source: string;
  copied: string[];
  skipped: string[];
  /** Source directory absent / unreadable / not running in Tauri. */
  missing: boolean;
  /** Per-API structural diff vs the previously-synced bundles. */
  diffs: SpecDiff[];
}

interface SourceSpec {
  api: string;
  content: string;
}

export async function copySpecs(specsDir?: string): Promise<SyncResult> {
  const source = (specsDir ?? (await getSpecsDir())).trim();
  if (!source || !isTauri()) {
    return { source, copied: [], skipped: [], missing: true, diffs: [] };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  let specs: SourceSpec[];
  try {
    specs = await invoke<SourceSpec[]>("read_source_specs", { dir: source });
  } catch {
    return { source, copied: [], skipped: [], missing: true, diffs: [] };
  }

  const copied: string[] = [];
  const skipped: string[] = [];
  const diffs: SpecDiff[] = [];
  for (const { api, content } of specs) {
    // Deprecated / merged APIs are never copied (e.g. payment-method).
    if (EXCLUDED_APIS.includes(api)) {
      skipped.push(api);
      continue;
    }
    // Capture the previously-synced bundle before overwriting so we can
    // report what moved. Missing → null → the API reads as "added".
    const previous = await readSpecFile(api);
    await writeSpecFile(api, content);
    copied.push(api);
    diffs.push(diffSpec(api, previous, content));
  }
  copied.sort();
  diffs.sort((a, b) => a.api.localeCompare(b.api));
  if (copied.length) {
    // Local-dir specs have no GitLab release tag — drop any stale one so the
    // UI shows "locales" rather than a tag these specs didn't come from.
    await clearSpecsTag();
    resetSpecCache();
  }
  return { source, copied, skipped, missing: false, diffs };
}

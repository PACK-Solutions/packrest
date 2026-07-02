// Read/write access to the OpenAPI spec files. In Tauri, specs live in the
// writable app-data dir (`$APPDATA/specs/<api>.yaml`) via tauri-plugin-fs, so
// runtime-synced bundles (local dir + GitLab) and the shipped seed share one
// source of truth. Outside Tauri (plain-browser `next dev`) it falls back to
// the read-only bundled static assets under `/specs/`.

import { isTauri } from "./platform";

const SPECS_DIR = "specs";

async function fsApi() {
  return import("@tauri-apps/plugin-fs");
}

// Bundled specs shipped with the app, listed in a manifest emitted by
// scripts/copy-specs.mjs. Served as a static asset by the webview (same origin
// → plain global fetch, not the http plugin).
async function fetchManifest(): Promise<string[]> {
  try {
    const res = await fetch("/specs/manifest.json");
    if (!res.ok) return [];
    const data = (await res.json()) as { apis?: unknown };
    return Array.isArray(data.apis) ? (data.apis as string[]) : [];
  } catch {
    return [];
  }
}

// The api ids present in the writable spec store (or the bundled manifest
// outside Tauri).
export async function listSpecFiles(): Promise<string[]> {
  if (isTauri()) {
    const { readDir, exists, BaseDirectory } = await fsApi();
    if (!(await exists(SPECS_DIR, { baseDir: BaseDirectory.AppData }))) return [];
    const entries = await readDir(SPECS_DIR, { baseDir: BaseDirectory.AppData });
    return entries
      .filter((e) => e.isFile && /\.ya?ml$/i.test(e.name))
      .map((e) => e.name.replace(/\.ya?ml$/i, ""));
  }
  return fetchManifest();
}

export async function readSpecFile(api: string): Promise<string | null> {
  if (isTauri()) {
    const { readTextFile, exists, BaseDirectory } = await fsApi();
    const rel = `${SPECS_DIR}/${api}.yaml`;
    if (!(await exists(rel, { baseDir: BaseDirectory.AppData }))) return null;
    return readTextFile(rel, { baseDir: BaseDirectory.AppData });
  }
  const res = await fetch(`/specs/${encodeURIComponent(api)}.yaml`);
  return res.ok ? res.text() : null;
}

export async function writeSpecFile(api: string, content: string): Promise<void> {
  if (!isTauri()) return; // bundled static assets are read-only outside Tauri
  const { writeTextFile, mkdir, exists, BaseDirectory } = await fsApi();
  if (!(await exists(SPECS_DIR, { baseDir: BaseDirectory.AppData })))
    await mkdir(SPECS_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(`${SPECS_DIR}/${api}.yaml`, content, {
    baseDir: BaseDirectory.AppData,
  });
}

// On first launch the writable spec store is empty; seed it from the bundled
// static specs so the app opens with APIs visible before any sync. No-op once
// specs exist (and outside Tauri, where the fallback reads bundled assets
// directly).
export async function seedSpecsIfEmpty(): Promise<void> {
  if (!isTauri()) return;
  if ((await listSpecFiles()).length > 0) return;
  const apis = await fetchManifest();
  for (const api of apis) {
    try {
      const res = await fetch(`/specs/${encodeURIComponent(api)}.yaml`);
      if (!res.ok) continue;
      await writeSpecFile(api, await res.text());
    } catch {
      // skip a spec that fails to seed; the rest still load
    }
  }
}

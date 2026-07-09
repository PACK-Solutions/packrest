// Read/write access to the OpenAPI spec files. In Tauri, specs live in the
// writable app-data dir (`$APPDATA/specs/<api>.yaml`) via tauri-plugin-fs, and
// are populated only by sync (GitLab release or local source dir). There is no
// bundled seed. Outside Tauri there is no writable store, so the API list is
// simply empty.

import { isTauri } from "./platform";

const SPECS_DIR = "specs";

async function fsApi() {
  return import("@tauri-apps/plugin-fs");
}

// The api ids present in the writable spec store. Empty outside Tauri.
export async function listSpecFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  const { readDir, exists, BaseDirectory } = await fsApi();
  if (!(await exists(SPECS_DIR, { baseDir: BaseDirectory.AppData }))) return [];
  const entries = await readDir(SPECS_DIR, { baseDir: BaseDirectory.AppData });
  return entries
    .filter((e) => e.isFile && /\.ya?ml$/i.test(e.name))
    .map((e) => e.name.replace(/\.ya?ml$/i, ""));
}

export async function readSpecFile(api: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { readTextFile, exists, BaseDirectory } = await fsApi();
  const rel = `${SPECS_DIR}/${api}.yaml`;
  if (!(await exists(rel, { baseDir: BaseDirectory.AppData }))) return null;
  return readTextFile(rel, { baseDir: BaseDirectory.AppData });
}

export async function writeSpecFile(api: string, content: string): Promise<void> {
  if (!isTauri()) return; // no writable store outside Tauri
  const { writeTextFile, mkdir, exists, BaseDirectory } = await fsApi();
  if (!(await exists(SPECS_DIR, { baseDir: BaseDirectory.AppData })))
    await mkdir(SPECS_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  await writeTextFile(`${SPECS_DIR}/${api}.yaml`, content, {
    baseDir: BaseDirectory.AppData,
  });
}

// Native file/folder dialogs (tauri-plugin-dialog), with no-op fallbacks
// outside Tauri so the code still type-checks and degrades gracefully.

import { isTauri } from "./platform";

export async function pickDirectory(title?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === "string" ? result : null;
}

export interface SaveFilter {
  name: string;
  extensions: string[];
}

export async function pickSavePath(
  defaultName: string,
  filters?: SaveFilter[],
): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ defaultPath: defaultName, filters })) ?? null;
}

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

// Note: saving files goes through the Rust `save_file` command (see
// lib/exporter.ts), which opens the save dialog itself so the destination path
// is never chosen by the webview. SaveFilter above is the shape it expects.

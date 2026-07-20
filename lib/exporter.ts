// Save generated files (Bruno .zip / .yml) to disk. In Tauri: the native save
// dialog is opened inside the Rust `save_file` command (so the destination path
// is chosen by the OS dialog, never by the webview) and the bytes are written
// there. Outside Tauri: a Blob + anchor download.

import { isTauri } from "./platform";
import { type SaveFilter } from "./dialog";

// Returns true when saved, false when the user cancelled.
export async function saveBytes(
  defaultName: string,
  bytes: Uint8Array,
  filters?: SaveFilter[],
): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    // The dialog lives in the Rust command; it returns the chosen path, or null
    // when the user cancelled.
    const path = await invoke<string | null>("save_file", {
      defaultName,
      filters: filters ?? [],
      contents: Array.from(bytes),
    });
    return path != null;
  }
  const blob = new Blob([bytes as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export async function saveText(
  defaultName: string,
  text: string,
  filters?: SaveFilter[],
): Promise<boolean> {
  return saveBytes(defaultName, new TextEncoder().encode(text), filters);
}

// Save generated files (Bruno .zip / .yml) to disk. In Tauri: a native save
// dialog picks the destination and the bytes are written via the `write_file`
// Rust command (arbitrary path, outside the fs-plugin scope). Outside Tauri:
// a Blob + anchor download.

import { isTauri } from "./platform";
import { pickSavePath, type SaveFilter } from "./dialog";

// Returns true when saved, false when the user cancelled.
export async function saveBytes(
  defaultName: string,
  bytes: Uint8Array,
  filters?: SaveFilter[],
): Promise<boolean> {
  if (isTauri()) {
    const path = await pickSavePath(defaultName, filters);
    if (!path) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_file", { path, contents: Array.from(bytes) });
    return true;
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

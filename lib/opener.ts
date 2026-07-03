// Open a URL (or file) in the system's default handler, via tauri-plugin-opener
// when running in the Tauri webview, else a plain `window.open` fallback for
// browser dev. Used by the in-app updater to hand the release installer's
// download URL to the OS browser.

import { isTauri } from "./platform";

export async function openUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl: open } = await import("@tauri-apps/plugin-opener");
    await open(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

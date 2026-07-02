// Runtime detection for the Tauri webview.
//
// The app is a Next.js static export loaded either by the Tauri webview
// (production and `tauri dev`) or by a plain browser (`next dev` opened
// directly, SSR/prerender at build). The Tauri-only paths — plugin-store,
// plugin-fs, plugin-http, plugin-dialog — must be guarded so the code still
// loads (and the build still prerenders) outside Tauri. Tauri v2 injects
// `__TAURI_INTERNALS__` onto the webview's window.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

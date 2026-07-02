// A fetch routed through Rust (tauri-plugin-http) when running in Tauri, so
// requests bypass the webview's CORS enforcement and header restrictions
// (e.g. a custom User-Agent) — exactly what the former /api/proxy and
// /api/token server routes existed to provide. Outside Tauri it falls back to
// the webview's fetch (subject to CORS; acceptable for plain-browser dev).

import { isTauri } from "./platform";

export async function tauriFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  if (isTauri()) {
    const { fetch: httpFetch } = await import("@tauri-apps/plugin-http");
    return httpFetch(input, init);
  }
  return fetch(input, init);
}

// Base64-encode raw bytes (no data: prefix) — response side of fileToBase64,
// used to hand binary downloads to the response viewer.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

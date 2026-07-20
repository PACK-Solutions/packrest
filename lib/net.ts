// A fetch routed through Rust (tauri-plugin-http) when running in Tauri, so
// requests bypass the webview's CORS enforcement and header restrictions
// (e.g. a custom User-Agent) — exactly what the former /api/proxy and
// /api/token server routes existed to provide. Outside Tauri it falls back to
// the webview's fetch (subject to CORS; acceptable for plain-browser dev).

import { isTauri } from "./platform";

// tauri-plugin-http extends the standard RequestInit with a few client options;
// `maxRedirections` is the one we use to stop credential-bearing requests from
// silently following redirects (which would bypass checkUrl and can leak the
// Authorization header to the redirect target).
export type TauriRequestInit = RequestInit & { maxRedirections?: number };
export async function tauriFetch(
  input: string,
  init?: TauriRequestInit,
): Promise<Response> {
  if (isTauri()) {
    const { fetch: httpFetch } = await import("@tauri-apps/plugin-http");
    return httpFetch(input, init);
  }
  return fetch(input, init);
}

// Thrown by `tauriFetchWithTimeout` when the deadline elapses.
export class FetchTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Timeout après ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
  }
}

export interface TimedFetch {
  res: Response;
  // Cancels the timeout. MUST be called (in a `finally`) once the response
  // body has been fully consumed. See the comment below for why this matters.
  done: () => void;
}

// `tauriFetch` + a timeout that is guaranteed not to fire after the request
// completes. We can't pass `AbortSignal.timeout()` straight to the HTTP plugin:
// the plugin attaches `abort` listeners to the signal and never removes them,
// so a timer that outlives the request fires later and calls `fetch_cancel` /
// `fetch_cancel_body` on an already-consumed resource — surfacing as an
// unhandled "The resource id N is invalid" rejection (caught by the Next dev
// overlay). Instead we drive our own AbortController and `clearTimeout` as soon
// as the caller signals the body has been read via `done()`.
export async function tauriFetchWithTimeout(
  input: string,
  init: TauriRequestInit,
  timeoutMs: number,
): Promise<TimedFetch> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await tauriFetch(input, { ...init, signal: controller.signal });
    return { res, done: () => clearTimeout(timer) };
  } catch (err) {
    clearTimeout(timer);
    if (timedOut) throw new FetchTimeoutError(timeoutMs);
    throw err;
  }
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

// Decode a base64 string (no data: prefix) back to raw bytes — inverse of
// bytesToBase64. Shared by the multipart request builder and the file viewer.
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

"use client";

import { saveToken, loadToken, type TokenState } from "./storage";
import { checkUrl } from "./url-policy";
import { tauriFetchWithTimeout } from "./net";

// OAuth2 Client Credentials, run directly against the IAM token endpoint via
// the Tauri HTTP plugin (no CORS, no server hop). Formerly proxied through
// /api/token; the SSRF allowlist (checkUrl) and 30s timeout are preserved.
// The client_secret never leaves the process — it's read from the store and
// posted straight to the token URL.

// Extrait lisible d'un corps de réponse brut : espaces/retours ligne compactés
// et coupe à ~300 caractères, pour qu'une page HTML d'erreur reste affichable
// dans un toast sans le noyer.
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 300 ? `${clean.slice(0, 300)}…` : clean;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function fetchToken(opts: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
}): Promise<TokenState> {
  const check = checkUrl(opts.tokenUrl);
  if (!check.ok) throw new Error(check.reason);

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  if (opts.scopes.length) form.set("scope", opts.scopes.join(" "));

  const basic = btoa(`${opts.clientId}:${opts.clientSecret}`);

  // The Gravitee gateway in front of the IAM rejects the production webview
  // origin (`tauri://localhost`) with a 403 (empty body). We override `Origin`
  // with the token endpoint's own origin (same-origin), which the gateway
  // accepts. Requires the `unsafe-headers` feature on tauri-plugin-http —
  // `Origin` is a forbidden header the plugin would otherwise drop.
  const timed = await tauriFetchWithTimeout(
    check.url.toString(),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Origin: check.url.origin,
      },
      body: form.toString(),
      // The token endpoint must never redirect us elsewhere: following a
      // redirect would carry the Basic client_secret to the redirect target
      // and bypass checkUrl. Treat any 3xx as an error instead.
      maxRedirections: 0,
    },
    30_000,
  );
  const res = timed.res;

  let text: string;
  try {
    text = await res.text();
  } finally {
    timed.done();
  }
  let data: TokenResponse | null = null;
  try {
    data = JSON.parse(text) as TokenResponse;
  } catch {
    // Corps non-JSON (page HTML d'erreur, texte brut, vide) — souvent le cas
    // d'un 403 renvoyé par la passerelle/WAF devant l'IAM. On garde le texte
    // brut pour le remonter tel quel plus bas.
  }

  if (!res.ok || data?.error) {
    const jsonMsg = data?.error_description ?? data?.error;
    if (jsonMsg) throw new Error(jsonMsg);
    const raw = snippet(text);
    throw new Error(
      raw ? `IAM HTTP ${res.status} : ${raw}` : `IAM HTTP ${res.status} (réponse vide)`,
    );
  }
  if (!data) {
    // 2xx mais corps illisible (non-JSON) — cas rare.
    const raw = snippet(text);
    throw new Error(
      raw
        ? `Réponse IAM illisible (HTTP ${res.status}) : ${raw}`
        : `Réponse IAM vide (HTTP ${res.status})`,
    );
  }
  if (!data.access_token) {
    throw new Error("La réponse IAM n'inclut pas access_token");
  }
  const state: TokenState = {
    accessToken: data.access_token,
    tokenType: data.token_type ?? "Bearer",
    expiresAt: Date.now() + (data.expires_in ?? 300) * 1000,
    scope: data.scope,
  };
  saveToken(state);
  return state;
}

export function currentToken(): TokenState | null {
  return loadToken();
}

export function clearToken(): void {
  saveToken(null);
}

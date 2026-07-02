"use client";

import { saveToken, loadToken, type TokenState } from "./storage";
import { checkUrl } from "./url-policy";
import { tauriFetch } from "./net";

// OAuth2 Client Credentials, run directly against the IAM token endpoint via
// the Tauri HTTP plugin (no CORS, no server hop). Formerly proxied through
// /api/token; the SSRF allowlist (checkUrl) and 30s timeout are preserved.
// The client_secret never leaves the process — it's read from the store and
// posted straight to the token URL.

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

  const res = await tauriFetch(check.url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let data: TokenResponse;
  try {
    data = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`Réponse IAM invalide (HTTP ${res.status})`);
  }
  if (!res.ok || data.error) {
    throw new Error(data.error_description ?? data.error ?? `HTTP ${res.status}`);
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

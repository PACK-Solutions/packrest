"use client";

import { saveToken, loadToken, type TokenState } from "./storage";

// Client-side helper that POSTs to /api/token and persists the resulting
// bearer in localStorage. Returns the fresh TokenState on success or an
// Error with a human-readable message.

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
  const res = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = (await res.json()) as TokenResponse;
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

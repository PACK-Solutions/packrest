"use client";

// OAuth2 token lifecycle for RequestBuilder: the current bearer (tracked as
// React state so every code path reads the freshest token without racing the
// render cycle), the in-flight/error UX, and the selected scopes. Also owns the
// live-header assembly shared by run / follow / curl.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchToken, currentToken } from "@/lib/token";
import { resolveTokenUrl, isPreset } from "@/lib/env";
import {
  loadSettings,
  credentialsFor,
  customEnvById,
  type SavedHeader,
  type TokenState,
} from "@/lib/storage";

export function useToken(params: {
  tokenUrl: string;
  initialScopes: string[];
}) {
  const { tokenUrl, initialScopes } = params;

  // Token panel + UX feedback. Token is tracked as React state so the
  // Authorization header in every code path always reflects the freshest
  // bearer — reading localStorage directly inside event handlers is racy
  // with React's render cycle.
  const [token, setToken] = useState<TokenState | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [fetchingToken, setFetchingToken] = useState(false);
  // Lazy init preserves the "required scopes pre-checked" behavior.
  const [selectedScopes, setSelectedScopes] = useState<string[]>(
    () => initialScopes,
  );

  useEffect(() => {
    setToken(currentToken());
    const sync = () => setToken(currentToken());
    const id = window.setInterval(sync, 1000);
    window.addEventListener("storage", sync);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const getToken = useCallback(async () => {
    setTokenError(null);
    setFetchingToken(true);
    try {
      const s = loadSettings();
      const creds = credentialsFor(s);
      if (!creds.clientId || !creds.clientSecret) {
        throw new Error(
          "Configurez clientId et clientSecret dans Paramètres avant de demander un token.",
        );
      }
      const fresh = await fetchToken({
        tokenUrl: resolveTokenUrl(
          s.environment,
          customEnvById(s, s.environment)?.tokenUrl ?? "",
          tokenUrl,
        ),
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        scopes: selectedScopes,
        custom: !isPreset(s.environment),
      });
      setToken(fresh);
      toast.success("Token obtenu", {
        description: `Scopes : ${fresh.scope ?? "(non renvoyé)"}`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      setTokenError(msg);
      toast.error("Impossible d'obtenir un token", { description: msg });
    } finally {
      setFetchingToken(false);
    }
  }, [tokenUrl, selectedScopes]);

  // Enabled custom headers plus the current bearer. Shared by run / follow /
  // curl so the Authorization + custom-header logic lives in one place.
  // Canonical capital `Bearer` — RFC 7235 says case-insensitive, but Gravitee
  // (and some other gateways) reject lowercase `bearer`.
  const buildLiveHeaders = useCallback(
    (customHeaders: SavedHeader[]): Record<string, string> => {
      const live = currentToken() ?? token;
      const headers: Record<string, string> = {};
      for (const h of customHeaders) {
        if (h.enabled !== false && h.key) headers[h.key] = h.value;
      }
      if (live) headers["Authorization"] = `Bearer ${live.accessToken}`;
      return headers;
    },
    [token],
  );

  return {
    token,
    setToken,
    tokenError,
    fetchingToken,
    selectedScopes,
    setSelectedScopes,
    getToken,
    buildLiveHeaders,
  };
}

// Tiny JWT decoder. We never verify the signature — PackRest just needs to
// surface the claims (scope, sub, aud, exp) for diagnosis: "why does the
// upstream return 403 with a token that looks fine in curl?" is almost
// always a scope or audience mismatch, and reading the claims confirms it.

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  jti?: string;
  scope?: string;
  scp?: string | string[];
  [key: string]: unknown;
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: JwtClaims;
  raw: { header: string; payload: string; signature: string };
}

function base64UrlDecode(input: string): string {
  const pad = input.length % 4;
  const normalized =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    (pad ? "=".repeat(4 - pad) : "");
  if (typeof atob === "function") return atob(normalized);
  return Buffer.from(normalized, "base64").toString("utf8");
}

export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0])) as Record<
      string,
      unknown
    >;
    const payload = JSON.parse(base64UrlDecode(parts[1])) as JwtClaims;
    return {
      header,
      payload,
      raw: { header: parts[0], payload: parts[1], signature: parts[2] },
    };
  } catch {
    return null;
  }
}

export function scopesFromClaims(claims: JwtClaims): string[] {
  if (typeof claims.scope === "string") return claims.scope.split(/\s+/).filter(Boolean);
  if (Array.isArray(claims.scp)) return claims.scp;
  if (typeof claims.scp === "string") return claims.scp.split(/\s+/).filter(Boolean);
  return [];
}

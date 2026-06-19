// Server-side URL allowlist consumed by /api/proxy and /api/token to
// prevent SSRF — without it, anyone who can POST to those routes can
// pivot the server onto internal services (Redis, AWS metadata, etc.).
//
// Hosts are matched by suffix so subdomains of the trusted vendors are
// covered. Private / loopback / link-local addresses are rejected before
// the suffix check; that closes the rebinding angle where DNS resolves an
// allowed name to 127.0.0.1.

const ALLOWED_HOST_SUFFIXES = [
  "pack-solutions.com",
  "pack-solutions.gravitee.cloud",
];

export interface UrlCheckOk {
  ok: true;
  url: URL;
}
export interface UrlCheckFail {
  ok: false;
  reason: string;
}
export type UrlCheck = UrlCheckOk | UrlCheckFail;

export function checkUrl(urlStr: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, reason: "URL invalide" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      ok: false,
      reason: `Protocole non autorisé : ${url.protocol}`,
    };
  }
  // Anti-SSRF: refuse private / loopback / link-local addresses before
  // checking the suffix, so a hostile DNS pointing `*.pack-solutions.com`
  // at 127.0.0.1 still gets rejected.
  if (isPrivateOrLocal(url.hostname)) {
    return {
      ok: false,
      reason: `Adresse privée non autorisée : ${url.hostname}`,
    };
  }
  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith("." + suffix),
  );
  if (!allowed) {
    return {
      ok: false,
      reason: `Host non autorisé : ${url.hostname}. Hosts acceptés : ${ALLOWED_HOST_SUFFIXES.join(", ")}.`,
    };
  }
  return { ok: true, url };
}

function isPrivateOrLocal(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "ip6-localhost") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h === "0.0.0.0") return true;
  // IPv4 private / loopback / link-local
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // includes 169.254.169.254 (AWS metadata)
  // IPv6 unique-local / link-local / loopback
  if (/^fe80:/i.test(h)) return true;
  if (/^fc[0-9a-f]{2}:/i.test(h)) return true;
  if (/^fd[0-9a-f]{2}:/i.test(h)) return true;
  return false;
}

// Allowlist of headers forwarded to the upstream by /api/proxy.
// Anything else is silently dropped. Authorization stays on the list
// because it's the bearer the user assembled here; everything else is
// either set by the proxy itself or shouldn't be controllable client-side
// (Cookie, Host, X-Forwarded-*, etc.).
export const PROXY_FORWARD_HEADERS = new Set([
  "authorization",
  "content-type",
  "accept",
  "accept-language",
  "accept-encoding",
  "user-agent",
  "x-request-id",
  "x-correlation-id",
  "x-trace-id",
  "x-idempotency-key",
  "x-api-key",
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
]);

export function filterForwardHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (PROXY_FORWARD_HEADERS.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

// Max upstream response size kept by the proxy before sending it back to
// the browser. 5 MB matches typical "big JSON" payloads while keeping the
// memory footprint bounded against an upstream that streams forever.
export const PROXY_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const PROXY_TIMEOUT_MS = 30_000;

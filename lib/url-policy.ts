// URL allowlist for the client-side token + proxy calls (lib/token.ts,
// lib/http.ts) — the SSRF guard those credentialed requests still need now that
// they run straight through the Tauri HTTP plugin instead of a server route.
//
// Hosts are matched by suffix so subdomains of the trusted vendors are covered.
// Private / loopback / link-local IP *literals* (in any notation) are also
// rejected. NOTE: this inspects the URL string only — it does not resolve DNS,
// so a name that RESOLVES to a private IP (true DNS rebinding) is not caught
// here. The suffix allowlist is the load-bearing control; the literal check is
// defence-in-depth against IP-literal SSRF.

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

export interface UrlCheckOptions {
  // When the URL belongs to a user-defined custom environment, http:// is
  // permitted (not only https), and localhost / 127.0.0.1 loopback is allowed
  // for a local dev server. The pack-solutions host allowlist and the private
  // (non-loopback) IP block still apply to every other custom host.
  custom?: boolean;
}

export function checkUrl(
  urlStr: string,
  opts: UrlCheckOptions = {},
): UrlCheck {
  const { custom = false } = opts;
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, reason: "URL invalide" };
  }
  const httpAllowed = custom && url.protocol === "http:";
  if (url.protocol !== "https:" && !httpAllowed) {
    return {
      ok: false,
      reason: `Protocole non autorisé : ${url.protocol}`,
    };
  }
  // Custom envs may target a local dev server on localhost / 127.0.0.1 — this
  // bypasses both the private-IP block and the host allowlist (but only for
  // loopback, not the wider LAN ranges).
  if (custom && isLoopbackHost(url.hostname)) {
    return { ok: true, url };
  }
  // Defence-in-depth: reject private / loopback / link-local IP *literals* (in
  // any notation) before the suffix check. This does not resolve DNS, so it
  // cannot stop a name resolving to a private IP — the allowlist does that.
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

// localhost / 127.0.0.0/8 / IPv6 ::1 — the loopback addresses we open up for
// custom envs (a local dev server). Narrower than isPrivateOrLocal, which also
// rejects the LAN ranges (10/8, 192.168/16, …) that stay blocked.
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "ip6-localhost") return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  const ip = parseIPv4(h);
  return ip !== null && ((ip >>> 24) & 0xff) === 127;
}

function isPrivateOrLocal(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "" || h === "localhost" || h === "ip6-localhost") return true;

  // IPv6 loopback / unspecified / unique-local / link-local.
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return true;
  if (/^fe80:/i.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  // IPv4-mapped / -compatible IPv6 (e.g. ::ffff:169.254.169.254, ::ffff:7f00:1):
  // pull out the embedded IPv4 and re-check it.
  const mapped = /^::(?:ffff:)?([0-9a-f.:]+)$/i.exec(h);
  if (mapped) {
    const inner = mapped[1];
    if (inner.includes(".")) {
      if (isPrivateIPv4(inner)) return true;
    } else {
      const g = inner.split(":").filter(Boolean);
      if (g.length === 2) {
        const hi = parseInt(g[0], 16);
        const lo = parseInt(g[1], 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          const ip = (((hi << 16) | lo) >>> 0);
          if (isPrivateIPv4Num(ip)) return true;
        }
      }
    }
  }

  return isPrivateIPv4(h);
}

// Parse an IPv4 in any of the notations a C resolver (inet_aton) accepts:
// dotted decimal, dotted hex/octal, short forms (127.1), or a single 32-bit
// integer (2130706433, 0x7f000001). Returns the packed address, or null when
// `s` is not numeric-IPv4-shaped (i.e. an ordinary hostname).
function parseIPv4(s: string): number | null {
  const parts = s.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^(0|[1-9]\d*)$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  const last = nums.length - 1;
  for (let i = 0; i < last; i++) if (nums[i] > 255) return null;
  if (nums[last] >= Math.pow(256, 4 - last)) return null;
  let ip = 0;
  for (let i = 0; i < last; i++) ip += nums[i] * Math.pow(256, 3 - i);
  ip += nums[last];
  return ip >>> 0;
}

function isPrivateIPv4Num(ip: number): boolean {
  const a = (ip >>> 24) & 0xff;
  const b = (ip >>> 16) & 0xff;
  if (a === 0) return true; // 0.0.0.0/8 (includes the bare 0 / 0.0.0.0)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (AWS metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function isPrivateIPv4(s: string): boolean {
  const ip = parseIPv4(s);
  return ip !== null && isPrivateIPv4Num(ip);
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

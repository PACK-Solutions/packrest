import { NextResponse } from "next/server";
import {
  checkUrl,
  filterForwardHeaders,
  PROXY_MAX_RESPONSE_BYTES,
  PROXY_TIMEOUT_MS,
} from "@/lib/url-policy";

// CORS-bypass proxy. The browser POSTs the intended request shape to this
// route; we fetch it server-side and return status + headers + body. This
// lets PackRest hit api.pack-solutions.com regardless of CORS posture.
//
// Request body: { method, url, headers?: Record<string,string>, body?: string|object }
// Response:     200 { status, statusText, headers, body, durationMs }
//
// Security:
//   • `url` must point to an allowlisted host (lib/url-policy).
//   • Only safelisted headers are forwarded to the upstream (no Cookie,
//     X-Forwarded-*, Host…).
//   • Upstream response is capped at PROXY_MAX_RESPONSE_BYTES and aborted
//     after PROXY_TIMEOUT_MS so a slow/huge upstream can't pin the server.

export const dynamic = "force-dynamic";

interface ProxyMultipart {
  fields?: Record<string, string>;
  files?: {
    field: string;
    filename: string;
    contentType: string;
    base64: string;
  }[];
}

interface ProxyRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown> | null;
  // multipart/form-data upload. The browser can't send binary through the
  // JSON proxy body, so files arrive base64-encoded and are rebuilt into a
  // FormData here. base64 inflates payloads ~33% (a 10 MB file → ~13 MB JSON);
  // fine for a local dev tool.
  multipart?: ProxyMultipart;
}

interface ProxyFile {
  base64: string;
  contentType: string;
  filename?: string;
  size: number;
}

// Content types we render as text. Everything else (PDF, octet-stream,
// image/*, zip, xlsx…) is treated as a file download. text/csv is textual
// per RFC but the contracts serve it as an attachment, so the
// Content-Disposition check below catches it regardless.
const TEXTUAL_CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "text/html",
  "application/xml",
  "text/xml",
  "application/x-www-form-urlencoded",
];

function isTextualContentType(contentType: string): boolean {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if (!ct) return true; // no content-type → assume text (current behaviour)
  if (ct.endsWith("+json") || ct.endsWith("+xml")) return true; // hal/problem
  return TEXTUAL_CONTENT_TYPES.includes(ct);
}

function isDownloadResponse(
  contentType: string,
  disposition: string,
): boolean {
  if (disposition.toLowerCase().includes("attachment")) return true;
  return !isTextualContentType(contentType);
}

// Extract the filename from a Content-Disposition header. Handles both the
// quoted `filename="cni.pdf"` form and RFC 5987 `filename*=UTF-8''cni.pdf`.
function parseFilename(disposition: string): string | undefined {
  if (!disposition) return undefined;
  const ext = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (ext) {
    try {
      return decodeURIComponent(ext[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return ext[1].trim().replace(/^"|"$/g, "");
    }
  }
  const basic = /filename=("?)([^";]+)\1/i.exec(disposition);
  if (basic) return basic[2].trim();
  return undefined;
}

export async function POST(req: Request) {
  let payload: ProxyRequest;
  try {
    payload = (await req.json()) as ProxyRequest;
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "Body must be JSON" },
      { status: 400 },
    );
  }
  const { method, url, headers: rawHeaders = {}, body, multipart } = payload;
  if (!method || !url) {
    return NextResponse.json(
      { error: "invalid_request", message: "method and url are required" },
      { status: 400 },
    );
  }
  const urlCheck = checkUrl(url);
  if (!urlCheck.ok) {
    return NextResponse.json(
      { error: "forbidden_url", message: urlCheck.reason },
      { status: 400 },
    );
  }

  // Strip everything except headers on the forward allowlist; the
  // upstream should never see arbitrary Cookie / X-Forwarded-For from a
  // browser. The dropped headers are reported back so the UI can warn.
  const headers = filterForwardHeaders(rawHeaders);
  const droppedHeaders = Object.keys(rawHeaders).filter(
    (k) => !(k in headers) && k.toLowerCase() !== "host",
  );

  // Node's fetch (undici) defaults `User-Agent` to `node`. Gravitee
  // deployments with WAF/OWASP rules sometimes block that token outright,
  // returning 403 on requests that work fine from curl. Set a recognisable
  // UA unless the caller overrides it.
  if (!hasHeader(headers, "user-agent")) {
    headers["User-Agent"] = "PackRest/0.1 (+https://pack-solutions.com)";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  const init: RequestInit = {
    method: method.toUpperCase(),
    headers,
    signal: controller.signal,
  };
  // Human-readable summary of a multipart body for the request echo (binary
  // can't be stringified back to the UI); null for JSON/string/empty bodies.
  const multipartSummary = applyRequestBody(
    init,
    headers,
    method,
    body,
    multipart,
  );

  const start = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(urlCheck.url, init);
  } catch (err) {
    clearTimeout(timeout);
    const message =
      (err as Error).name === "AbortError"
        ? `Timeout après ${PROXY_TIMEOUT_MS}ms`
        : (err as Error).message;
    return NextResponse.json(
      {
        status: 0,
        statusText: "Fetch failed",
        headers: {},
        body: { error: message },
        durationMs: Date.now() - start,
      },
      { status: 200 },
    );
  }
  let bytes: Uint8Array = new Uint8Array(0);
  let truncated = false;
  try {
    bytes = await readBodyWithCap(upstream, PROXY_MAX_RESPONSE_BYTES);
  } catch (err) {
    if ((err as Error).message === "body_too_large") {
      truncated = true;
    } else {
      clearTimeout(timeout);
      throw err;
    }
  }
  clearTimeout(timeout);
  const durationMs = Date.now() - start;
  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const ct = upstream.headers.get("content-type") ?? "";
  const disposition = upstream.headers.get("content-disposition") ?? "";

  // File-download responses (PDF, images, CSV/XLSX, octet-stream…) must NOT
  // be decoded as UTF-8 text — that corrupts the bytes. Detect them on the
  // *actual* response and return base64 + metadata so the UI can offer a
  // viewer / download instead of dumping raw content.
  let parsedBody: unknown;
  let file: ProxyFile | undefined;
  if (!truncated && isDownloadResponse(ct, disposition)) {
    file = {
      base64: Buffer.from(bytes).toString("base64"),
      contentType: ct || "application/octet-stream",
      filename: parseFilename(disposition),
      size: bytes.byteLength,
    };
    parsedBody = { message: "Fichier binaire — voir l'aperçu ci-dessous." };
  } else {
    // Try to parse as JSON for convenience; fall back to raw text.
    const text = truncated ? "" : new TextDecoder().decode(bytes);
    parsedBody = text;
    if (ct.includes("json") && text.length) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        // keep raw
      }
    }
  }
  if (truncated) {
    parsedBody = {
      error: "response_too_large",
      message: `Réponse upstream tronquée à ${PROXY_MAX_RESPONSE_BYTES} octets.`,
    };
  }
  // Echo the request as actually sent so the UI can show "voici ce qui est
  // parti". The Authorization value is intentionally NOT masked — PackRest
  // is a local dev tool, the bearer is already in localStorage / DevTools,
  // and the user needs to compare against their own curl/JWT decode to
  // diagnose 4xx from upstream.
  const sentHeaders = init.headers as Record<string, string>;
  const echoBody =
    typeof init.body === "string"
      ? init.body.length > 8192
        ? `${init.body.slice(0, 8192)}…`
        : init.body
      : multipartSummary;
  if (process.env.NODE_ENV !== "production") {
    // Surface what Node.js fetch is sending so the user can compare with
    // their working curl directly from the terminal.
    console.log(
      `[packrest:proxy] → ${init.method} ${url}\n  headers: ${JSON.stringify(sentHeaders)}\n  body: ${echoBody ? echoBody.slice(0, 200) : "(none)"}\n  status: ${upstream.status} (${durationMs}ms)`,
    );
  }
  return NextResponse.json({
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
    body: parsedBody,
    file,
    durationMs,
    droppedHeaders,
    truncated,
    request: {
      method: init.method,
      url,
      headers: sentHeaders,
      body: echoBody,
    },
  });
}

// Populate `init.body` (and adjust `headers`, which is `init.headers`) from the
// JSON or multipart payload. GET requests carry no body. Returns the multipart
// echo summary, or null for JSON/string/empty bodies.
function applyRequestBody(
  init: RequestInit,
  headers: Record<string, string>,
  method: string,
  body: ProxyRequest["body"],
  multipart: ProxyMultipart | undefined,
): string | null {
  if (method.toUpperCase() === "GET") return null;
  if (isNonEmptyMultipart(multipart)) {
    return applyMultipartBody(init, headers, multipart);
  }
  if (body === undefined || body === null) return null;
  if (typeof body === "string") {
    init.body = body;
  } else {
    init.body = JSON.stringify(body);
    if (!hasHeader(headers, "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }
  return null;
}

function isNonEmptyMultipart(
  m: ProxyMultipart | undefined,
): m is ProxyMultipart {
  return (
    m != null &&
    ((m.fields != null && Object.keys(m.fields).length > 0) ||
      (m.files != null && m.files.length > 0))
  );
}

function applyMultipartBody(
  init: RequestInit,
  headers: Record<string, string>,
  multipart: ProxyMultipart,
): string {
  const form = new FormData();
  const parts: string[] = [];
  for (const [k, v] of Object.entries(multipart.fields ?? {})) {
    form.append(k, v);
    parts.push(`${k}=${v}`);
  }
  for (const f of multipart.files ?? []) {
    const bytes = Buffer.from(f.base64, "base64");
    form.append(
      f.field,
      new Blob([bytes], { type: f.contentType || "application/octet-stream" }),
      f.filename,
    );
    parts.push(`${f.field}=${f.filename} (${formatBytes(bytes.byteLength)})`);
  }
  init.body = form;
  // Let undici derive the multipart boundary — a caller-supplied Content-Type
  // would clobber it and break the upstream parse.
  deleteHeader(headers, "content-type");
  return `[multipart] ${parts.join("; ")}`;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) delete headers[k];
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Reads the upstream body in chunks, throwing `body_too_large` once we
// exceed `maxBytes` so we never load a runaway response fully into RAM.
// Returns raw bytes; the caller decides whether to decode as text or
// base64-encode as a file.
async function readBodyWithCap(
  resp: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!resp.body) {
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error("body_too_large");
    return new Uint8Array(buf);
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

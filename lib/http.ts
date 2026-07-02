"use client";

// Direct HTTP execution for the request builder. Formerly a POST to the
// server-side /api/proxy (CORS bypass + SSRF hardening); now the request runs
// straight through the Tauri HTTP plugin, which is not subject to the
// webview's CORS. The load-bearing proxy behaviours are preserved here:
//   • url allowlist (checkUrl) + forward-header safelist (filterForwardHeaders)
//   • a recognisable User-Agent (Gravitee WAF rejects the default)
//   • a 5 MB response cap and 30 s timeout
//   • binary/attachment responses returned as base64 + metadata
//   • multipart/form-data rebuilt into a real FormData

import {
  checkUrl,
  filterForwardHeaders,
  PROXY_MAX_RESPONSE_BYTES,
  PROXY_TIMEOUT_MS,
} from "./url-policy";
import { tauriFetch, bytesToBase64 } from "./net";

// Set when the upstream returned a file download (binary or attachment).
// The body is a short placeholder in that case; the bytes live here as
// base64 so the UI can offer a viewer / download instead of raw content.
export interface ProxyFile {
  base64: string;
  contentType: string;
  filename?: string;
  size: number;
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  file?: ProxyFile;
  durationMs: number;
  droppedHeaders?: string[];
  truncated?: boolean;
  request?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
  };
}

// A multipart/form-data payload. Files carry base64 for a uniform interface
// with the previous proxy; they're decoded back into Blobs here.
export interface MultipartPayload {
  fields: Record<string, string>;
  files: {
    field: string;
    filename: string;
    contentType: string;
    base64: string;
  }[];
}

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
  if (!ct) return true;
  if (ct.endsWith("+json") || ct.endsWith("+xml")) return true;
  return TEXTUAL_CONTENT_TYPES.includes(ct);
}

function isDownloadResponse(contentType: string, disposition: string): boolean {
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

export async function executeRequest(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | object | null;
  multipart?: MultipartPayload;
}): Promise<ProxyResponse> {
  const { method, url, headers: rawHeaders = {}, body, multipart } = opts;
  const urlCheck = checkUrl(url);
  if (!urlCheck.ok) throw new Error(urlCheck.reason);

  const headers = filterForwardHeaders(rawHeaders);
  const droppedHeaders = Object.keys(rawHeaders).filter(
    (k) => !(k in headers) && k.toLowerCase() !== "host",
  );
  if (!hasHeader(headers, "user-agent")) {
    headers["User-Agent"] = "PackRest/0.1 (+https://pack-solutions.com)";
  }

  const init: RequestInit = { method: method.toUpperCase(), headers };
  const multipartSummary = applyRequestBody(init, headers, method, body, multipart);

  const start = Date.now();
  let upstream: Response;
  try {
    upstream = await tauriFetch(urlCheck.url.toString(), {
      ...init,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    const message =
      (err as Error).name === "TimeoutError" ||
      (err as Error).name === "AbortError"
        ? `Timeout après ${PROXY_TIMEOUT_MS}ms`
        : (err as Error).message;
    return {
      status: 0,
      statusText: "Fetch failed",
      headers: {},
      body: { error: message },
      durationMs: Date.now() - start,
    };
  }

  const rawBytes = new Uint8Array(await upstream.arrayBuffer());
  const truncated = rawBytes.byteLength > PROXY_MAX_RESPONSE_BYTES;
  const bytes = truncated ? new Uint8Array(0) : rawBytes;
  const durationMs = Date.now() - start;

  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const ct = upstream.headers.get("content-type") ?? "";
  const disposition = upstream.headers.get("content-disposition") ?? "";

  let parsedBody: unknown;
  let file: ProxyFile | undefined;
  if (truncated) {
    parsedBody = {
      error: "response_too_large",
      message: `Réponse upstream tronquée à ${PROXY_MAX_RESPONSE_BYTES} octets.`,
    };
  } else if (isDownloadResponse(ct, disposition)) {
    file = {
      base64: bytesToBase64(bytes),
      contentType: ct || "application/octet-stream",
      filename: parseFilename(disposition),
      size: bytes.byteLength,
    };
    parsedBody = { message: "Fichier binaire — voir l'aperçu ci-dessous." };
  } else {
    const text = new TextDecoder().decode(bytes);
    parsedBody = text;
    if (ct.includes("json") && text.length) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        // keep raw text
      }
    }
  }

  const sentHeaders = init.headers as Record<string, string>;
  const echoBody =
    typeof init.body === "string"
      ? init.body.length > 8192
        ? `${init.body.slice(0, 8192)}…`
        : init.body
      : multipartSummary;

  return {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
    body: parsedBody,
    file,
    durationMs,
    droppedHeaders,
    truncated,
    request: {
      method: init.method as string,
      url,
      headers: sentHeaders,
      body: echoBody,
    },
  };
}

// Populate `init.body` (and adjust `headers`, which is `init.headers`) from the
// JSON or multipart payload. GET requests carry no body. Returns the multipart
// echo summary, or null for JSON/string/empty bodies.
function applyRequestBody(
  init: RequestInit,
  headers: Record<string, string>,
  method: string,
  body: string | object | null | undefined,
  multipart: MultipartPayload | undefined,
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
  m: MultipartPayload | undefined,
): m is MultipartPayload {
  return (
    m != null &&
    ((m.fields != null && Object.keys(m.fields).length > 0) ||
      (m.files != null && m.files.length > 0))
  );
}

function applyMultipartBody(
  init: RequestInit,
  headers: Record<string, string>,
  multipart: MultipartPayload,
): string {
  const form = new FormData();
  const parts: string[] = [];
  for (const [k, v] of Object.entries(multipart.fields ?? {})) {
    form.append(k, v);
    parts.push(`${k}=${v}`);
  }
  for (const f of multipart.files ?? []) {
    const bytes = base64ToBytes(f.base64);
    form.append(
      f.field,
      new Blob([bytes as BlobPart], {
        type: f.contentType || "application/octet-stream",
      }),
      f.filename,
    );
    parts.push(`${f.field}=${f.filename} (${formatBytes(bytes.byteLength)})`);
  }
  init.body = form;
  // Let the HTTP layer derive the multipart boundary — a caller-supplied
  // Content-Type would clobber it and break the upstream parse.
  deleteHeader(headers, "content-type");
  return `[multipart] ${parts.join("; ")}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// Read a browser File into a base64 string (no data: prefix) for the multipart
// payload.
export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

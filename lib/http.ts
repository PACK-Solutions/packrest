"use client";

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
  request?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
  };
}

// A multipart/form-data payload, conveyed to the proxy as JSON. Files are
// base64-encoded here and reconstructed into a real FormData server-side (the
// proxy lets fetch derive the multipart boundary). Symmetric with the
// response-side base64 file handling.
export interface MultipartPayload {
  fields: Record<string, string>;
  files: {
    field: string;
    filename: string;
    contentType: string;
    base64: string;
  }[];
}

export async function executeRequest(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | object | null;
  multipart?: MultipartPayload;
}): Promise<ProxyResponse> {
  const res = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Proxy error ${res.status}: ${text}`);
  }
  return (await res.json()) as ProxyResponse;
}

// Read a browser File into a base64 string (no data: prefix) for transport to
// the proxy inside the JSON request body.
export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

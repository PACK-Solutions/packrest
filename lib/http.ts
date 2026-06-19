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

export async function executeRequest(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | object | null;
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

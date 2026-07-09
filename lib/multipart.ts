// Pure helpers for multipart/form-data request bodies. Lifted out of
// RequestBuilder (module-scope, no React).

import { fileToBase64, type MultipartPayload } from "@/lib/http";
import { formatFileSize } from "@/lib/utils";

// Assemble a MultipartPayload from the metadata object + picked files. Empty
// metadata fields are dropped; non-string values are JSON-encoded (e.g. the
// `metadata` object part). Files are base64-encoded for transport to the proxy.
export async function buildMultipart(
  value: unknown,
  files: Record<string, File | null>,
): Promise<MultipartPayload> {
  const fields: Record<string, string> = {};
  const obj = (
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    fields[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  const out: MultipartPayload["files"] = [];
  for (const [field, f] of Object.entries(files)) {
    if (!f) continue;
    out.push({
      field,
      filename: f.name,
      contentType: f.type || "application/octet-stream",
      base64: await fileToBase64(f),
    });
  }
  return { fields, files: out };
}

// Total size of the picked files, formatted for the upload progress label.
export function formatUploadSize(files: Record<string, File | null>): string {
  const n = Object.values(files).reduce((sum, f) => sum + (f?.size ?? 0), 0);
  return formatFileSize(n);
}

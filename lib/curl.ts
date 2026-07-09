// Pure helpers for the "Copier en curl" preview and the header-editor's managed
// rows. Lifted out of RequestBuilder (module-scope, no React) so the component
// is orchestration + JSX only.

// Build a curl command exactly mirroring what the proxy will send. Used by
// the "Copier en curl" button so the user can paste a working command into
// a terminal and compare diff with their own curl.
export function buildCurl(opts: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | null;
  // multipart/form-data parts. When present, `-F` flags are emitted (and
  // curl sets the multipart Content-Type + boundary itself) instead of
  // `--data-raw`.
  form?: {
    fields: Record<string, string>;
    files: { field: string; filename: string }[];
  };
}): string {
  const lines: string[] = [
    `curl -X ${opts.method.toUpperCase()} '${escapeSingleQuotes(opts.url)}'`,
  ];
  for (const [k, v] of Object.entries(opts.headers)) {
    lines.push(`-H '${escapeSingleQuotes(`${k}: ${v}`)}'`);
  }
  if (opts.form) {
    for (const [k, v] of Object.entries(opts.form.fields)) {
      lines.push(`-F '${escapeSingleQuotes(`${k}=${v}`)}'`);
    }
    for (const f of opts.form.files) {
      lines.push(`-F '${escapeSingleQuotes(`${f.field}=@${f.filename}`)}'`);
    }
  } else if (opts.body) {
    lines.push(`--data-raw '${escapeSingleQuotes(opts.body)}'`);
  }
  return lines.join(" \\\n  ");
}

// Same field/file collection as buildMultipart, but shaped for a curl `-F`
// preview (filenames only, no base64).
export function curlForm(
  value: unknown,
  files: Record<string, File | null>,
): { fields: Record<string, string>; files: { field: string; filename: string }[] } {
  const fields: Record<string, string> = {};
  const obj = (
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    fields[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  const outFiles: { field: string; filename: string }[] = [];
  for (const [field, f] of Object.entries(files)) {
    if (f) outFiles.push({ field, filename: f.name });
  }
  return { fields, files: outFiles };
}

export function escapeSingleQuotes(s: string): string {
  return s.replace(/'/g, "'\\''");
}

// The Content-Type the proxy will set, as a managed header row. JSON bodies
// are stamped application/json; multipart uploads get the boundary from fetch,
// so we only show the bare type. GET / bodyless requests get no row.
export function managedContentType(
  hasJsonBody: boolean,
  isMultipart: boolean,
): { key: string; value: string }[] {
  if (hasJsonBody) return [{ key: "Content-Type", value: "application/json" }];
  if (isMultipart)
    return [{ key: "Content-Type", value: "multipart/form-data" }];
  return [];
}

export function maskToken(token: string): string {
  if (token.length <= 12) return "••••";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

// Greyed-out managed rows for the header editor: the (masked) bearer plus the
// Content-Type the proxy will set for the body.
export function buildManagedHeaders(
  accessToken: string | undefined,
  hasJsonBody: boolean,
  isMultipart: boolean,
): { key: string; value: string }[] {
  return [
    ...(accessToken
      ? [{ key: "Authorization", value: `Bearer ${maskToken(accessToken)}` }]
      : []),
    ...managedContentType(hasJsonBody, isMultipart),
  ];
}

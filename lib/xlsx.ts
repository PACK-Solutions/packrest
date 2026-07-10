// Client-side Excel (.xlsx) export of a parsed JSON response. A .xlsx is a zip
// of OOXML parts; we hand-write the minimal set (inline-string cells, one bold
// header style) and zip them with fflate — the same dependency BrunoExportButton
// already uses. No spreadsheet library, no numeric/locale ambiguity.
//
// Pure entry points:
//   sanitizeForExport(body) — strip HAL noise, unwrap a collection wrapper
//   flattenToRows(body)     — sanitize, then → { columns, rows } (dotted keys)
//   buildXlsx(table, meta?) — → Uint8Array workbook bytes (with request header)

import { zipSync, strToU8 } from "fflate";

import { booleanLabel, formatMaybeDate, humanizeKey, NULL_LABEL } from "./humanize";

export interface FlatTable {
  columns: string[];
  rows: Record<string, string>[];
}

// Request context shown as a header block above the data, so a product owner
// reading the file knows which call produced it.
export interface ExportMeta {
  apiTitle?: string;
  endpoint?: string; // e.g. "GET /orders/{id}"
  url?: string; // final request URL (query included)
  summary?: string; // endpoint summary/description
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// HAL/pagination wrapper keys that carry no domain data for a PO — dropped
// (`_links`, `_templates`) or peeled away (`_embedded`, single collection).
const NOISE_KEYS = new Set(["_links", "_templates", "_meta"]);
const PAGINATION_KEYS = new Set(["page", "pageable", "sort"]);

// Recursively strip HAL noise: drop `_links`/`_templates`/`_meta`, and lift
// each `_embedded` relation up to its parent (so `_embedded.orders` → `orders`).
function stripHalNoise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripHalNoise);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (NOISE_KEYS.has(key)) continue;
      if (key === "_embedded" && isPlainObject(v)) {
        for (const [rel, rv] of Object.entries(v)) {
          if (!(rel in out)) out[rel] = stripHalNoise(rv);
        }
        continue;
      }
      out[key] = stripHalNoise(v);
    }
    return out;
  }
  return value;
}

// When the cleaned body is a collection wrapper — a single array relation
// alongside only pagination metadata — unwrap to that array so the rows are
// the records themselves (e.g. `{ orders: [...], page: {...} }` → `[...]`).
function unwrapCollection(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const arrays = Object.entries(value).filter(([, v]) => Array.isArray(v));
  const others = Object.keys(value).filter((k) => !Array.isArray(value[k]));
  if (arrays.length === 1 && others.every((k) => PAGINATION_KEYS.has(k))) {
    return arrays[0][1];
  }
  return value;
}

// Prepare a response body for tabular export: strip HAL noise, then unwrap a
// collection wrapper down to its records.
export function sanitizeForExport(body: unknown): unknown {
  return unwrapCollection(stripHalNoise(body));
}

// Format a single leaf value into a human-readable cell string, reusing the
// same helpers as the "Lisible" tree.
function formatLeaf(value: unknown): string {
  if (value === null || value === undefined) return NULL_LABEL;
  if (typeof value === "boolean") return booleanLabel(value);
  if (typeof value === "string") return formatMaybeDate(value) ?? value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return String(value);
}

// Recursively flatten a record into dotted-key cells. Objects recurse by key,
// arrays by index; leaves land under their dotted path (or "valeur" at the root
// when the record itself is a primitive). Empty containers yield a blank cell.
function flattenInto(
  value: unknown,
  prefix: string,
  out: Record<string, string>,
): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out[prefix || "valeur"] = "";
      return;
    }
    value.forEach((item, i) => {
      flattenInto(item, prefix ? `${prefix}.${i}` : String(i), out);
    });
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out[prefix || "valeur"] = "";
      return;
    }
    for (const key of keys) {
      flattenInto(value[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  out[prefix || "valeur"] = formatLeaf(value);
}

// Turn a parsed response body into a flat table. An array becomes one row per
// element; anything else becomes a single row. Columns are the ordered union of
// keys seen across rows (first-seen order); missing cells stay blank.
export function flattenToRows(body: unknown): FlatTable {
  const clean = sanitizeForExport(body);
  const records: unknown[] = Array.isArray(clean) ? clean : [clean];
  const rows = records.map((record) => {
    const out: Record<string, string> = {};
    flattenInto(record, "", out);
    return out;
  });
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return { columns, rows };
}

// Characters forbidden in XML 1.0: control chars (except tab/LF/CR) and lone
// surrogates. A JSON response can carry these via \u escapes; emitted raw they
// make the workbook invalid and Excel refuses to open it. Strip them first.
const XML_INVALID_RE =
  /[\x00-\x08\x0B\x0C\x0E-\x1F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function xmlEscape(text: string): string {
  return text
    .replace(XML_INVALID_RE, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 0 → "A", 25 → "Z", 26 → "AA", ...
function colName(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface Cell {
  text: string;
  bold: boolean;
}

function cell(ref: string, { text, bold }: Cell): string {
  const style = bold ? ' s="1"' : "";
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

// Humanize each dotted segment of a flattened column path so nested headers
// read as "Address.City" rather than "Address.city".
function humanizeColumn(col: string): string {
  return col
    .split(".")
    .map((seg) => humanizeKey(seg))
    .join(".");
}

// Build the metadata header block (label/value rows + a blank separator).
// Empty when no meta or no populated fields.
function metaRows(meta?: ExportMeta): Cell[][] {
  if (!meta) return [];
  const pairs: [string, string | undefined][] = [
    ["API", meta.apiTitle],
    ["Endpoint", meta.endpoint],
    ["Description", meta.summary],
    ["Requête", meta.url],
  ];
  const rows = pairs
    .filter(([, value]) => value)
    .map(([label, value]): Cell[] => [
      { text: label, bold: true },
      { text: value ?? "", bold: false },
    ]);
  if (rows.length === 0) return [];
  rows.push([]); // blank separator before the data table
  return rows;
}

// Assemble every sheet row (metadata block, then the humanized header, then
// data) as a uniform cell model, so serialization owns the row/column indices.
function sheetRows(table: FlatTable, meta?: ExportMeta): Cell[][] {
  const rows: Cell[][] = metaRows(meta);
  rows.push(table.columns.map((col): Cell => ({ text: humanizeColumn(col), bold: true })));
  for (const row of table.rows) {
    rows.push(table.columns.map((col): Cell => ({ text: row[col] ?? "", bold: false })));
  }
  return rows;
}

function sheetXml(table: FlatTable, meta?: ExportMeta): string {
  const rowsXml = sheetRows(table, meta).map((cells, r) => {
    const rowNum = r + 1;
    const cellsXml = cells
      .map((c, i) => cell(`${colName(i)}${rowNum}`, c))
      .join("");
    return `<row r="${rowNum}">${cellsXml}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml.join("")}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Réponse" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// Font index 0 = default, 1 = bold. Cell style index 1 applies the bold font.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

// Build a minimal, valid .xlsx workbook (single sheet, inline strings, bold
// header row) from a flat table.
export function buildXlsx(table: FlatTable, meta?: ExportMeta): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    "xl/workbook.xml": strToU8(WORKBOOK),
    "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
    "xl/styles.xml": strToU8(STYLES),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(table, meta)),
  });
}

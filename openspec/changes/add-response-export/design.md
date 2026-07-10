## Context

The response panel (`components/ResponsePanel.tsx`) parses the body once into `parsedBody` and renders it as raw JSON (`JsonHighlighted`) or the "Lisible" tree (`JsonTree`), toggled in the inner `BodyView` component. Its toolbar row already holds the "Copier" button (`ml-auto`). The app has a complete client-side save chain — `saveBytes(name, bytes, filters)` in `lib/exporter.ts` → `pickSavePath` (`lib/dialog.ts`) → Rust `write_file`, with a Blob-download browser fallback — and `BrunoExportButton.tsx` demonstrates the busy-state + toast UX and building a zip with `fflate`'s `zipSync`. No spreadsheet library is bundled; `fflate` is the only relevant dep. `lib/humanize.ts` provides `humanizeKey`, `formatMaybeDate`, `booleanLabel`, `NULL_LABEL`.

## Goals / Non-Goals

**Goals:**
- One-click export of the current structured response to a real `.xlsx` that opens cleanly in Excel/LibreOffice/Numbers.
- Reuse the existing save flow, humanize helpers, and button/toast pattern — zero new dependencies, zero Rust/capability changes.
- Deterministic flattening so nested HAL responses become a readable flat table.

**Non-Goals:**
- Multi-sheet workbooks, styling beyond a bold header row, column widths, or formulas.
- Exporting response headers/status metadata (body only).
- CSV/HTML formats (Excel `.xlsx` chosen).
- Round-tripping / re-importing the exported file.

## Decisions

**1. Format: minimal OOXML `.xlsx` via `fflate`.** A `.xlsx` is a zip of XML parts. `lib/xlsx.ts` hand-writes the minimal set — `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml` (one bold style for the header), `xl/worksheets/sheet1.xml` — and zips them with `zipSync` (same import already used by `BrunoExportButton`). All cells written as inline strings (`t="inlineStr"`) to avoid a shared-strings table; the header row references the bold cell style. This keeps the writer ~150 lines with no dependency and no numeric/locale ambiguity.

**2. Flattening: dotted keys, union columns.** `lib/xlsx.ts` exposes a pure `flattenToRows(body): { columns: string[]; rows: Record<string,string>[] }`:
- Array of objects → one row per element.
- Single object → one row.
- Array of primitives (or a bare primitive) → a single-column table (`valeur`).
- Recurse into nested objects/arrays building dotted paths (`address.city`, `_embedded.items.0.name`); leaves become cells. Columns are the ordered union of all keys across rows; missing cells blank.

**3. Cell formatting reuses humanize helpers.** Headers via `humanizeKey`. Leaf values: `formatMaybeDate` (ISO → localized) when it returns non-null, else `booleanLabel` for booleans, `NULL_LABEL` for null; strings/numbers as-is. XML-escape all text.

**4. Component: `ResponseExportButton.tsx`.** Mirrors `BrunoExportButton` — `variant="outline" size="sm"`, `Download`/`Loader2` icon, `busy` state, sonner toasts. Props `{ body: unknown; defaultName: string; disabled?: boolean }`. On click: `flattenToRows` → `buildXlsx` → `saveBytes(`${defaultName}.xlsx`, bytes, [{ name: "Classeur Excel", extensions: ["xlsx"] }])`; toast on success, error toast on failure.

**5. Mounting.** In `BodyView`, add the button in the existing toolbar row (after "Copier" or beside it), passing `parsedBody` and `disabled={!isStructured}`. Derive `defaultName` from the API/operation context already available to `ResponsePanel` (fallback `"reponse"`). The `isStructured` check already computed in `BodyView` is the single gate.

## Risks / Trade-offs

- **Hand-rolled OOXML can be malformed.** Mitigate by keeping to the minimal inline-string schema (a well-documented subset) and verifying the output opens in Excel/Numbers/LibreOffice during verification; escape `& < > "` in all cell text.
- **Deeply nested / large arrays produce many columns or huge files.** Acceptable for typical API responses; flattening is bounded by the response already held in memory. No pagination is attempted.
- **Dotted columns can get long for deep HAL `_embedded` trees.** Accepted per the chosen flattening; users wanting the tree still have the "Lisible" view.
- **Inline strings mean numbers export as text.** Deliberate — avoids locale/format surprises and keeps the writer simple; values remain human-readable.

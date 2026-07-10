## 1. Flattening + XLSX writer (`lib/xlsx.ts`)

- [x] 1.1 Add `flattenToRows(body: unknown): { columns: string[]; rows: Record<string, string>[] }` — array of objects → one row each; single object → one row; array of primitives / bare primitive → single `valeur` column; recurse nested objects/arrays into dotted-key paths (`address.city`, `_embedded.items.0.name`); columns = ordered union of keys, missing cells blank.
- [x] 1.2 Format leaf values reusing `lib/humanize.ts`: `formatMaybeDate` (fallback), `booleanLabel` for booleans, `NULL_LABEL` for null; strings/numbers as-is.
- [x] 1.3 Add `buildXlsx(columns, rows): Uint8Array` — write the minimal OOXML parts (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml` with one bold header style, `xl/worksheets/sheet1.xml`) using inline strings; header row uses `humanizeKey` + bold style; XML-escape `& < > "`; zip with `zipSync` from `fflate`.

## 2. Export button (`components/ResponseExportButton.tsx`)

- [x] 2.1 Create the client component mirroring `BrunoExportButton.tsx`: props `{ body: unknown; defaultName: string; disabled?: boolean }`, `variant="outline" size="sm"`, `Download`/`Loader2` icon, `busy` state.
- [x] 2.2 On click: `flattenToRows(body)` → `buildXlsx(...)` → `saveBytes(`${defaultName}.xlsx`, bytes, [{ name: "Classeur Excel", extensions: ["xlsx"] }])`; success toast on save, error toast on failure, ignore user cancel (`saved === false`).

## 3. Mount in the response panel (`components/ResponsePanel.tsx`)

- [x] 3.1 Render `<ResponseExportButton>` in the `BodyView` toolbar row (beside "Copier"), passing `parsedBody` and `disabled={!isStructured}`.
- [x] 3.2 Derive `defaultName` from the API/operation context available to `ResponsePanel` (e.g. `<api>-<operationId>` or endpoint slug), falling back to `"reponse"`.

## 4. Verify

- [x] 4.1 `npm run typecheck` passes.
- [x] 4.2 `npm run tauri:dev`: execute an endpoint returning an array of objects and one returning a nested HAL object; click "Exporter (Excel)", save, and open the `.xlsx` in Excel/Numbers/LibreOffice — confirm humanized bold headers, dotted-key columns for nested values, localized dates/booleans, no `[object Object]`, and no repair prompt.
- [x] 4.3 Confirm the button is disabled for empty/text/binary responses (tooltip shown) and that cancelling the save dialog writes nothing.

## Why

Non-developers use packrest to run API calls, but the response only shows as raw JSON or the "Lisible" tree — neither can be handed to a colleague, filed, or opened in a familiar tool. A one-click export to a real Excel workbook lets users capture a response as a spreadsheet they already know how to read and share.

## What Changes

- Add an **"Exporter (Excel)"** button to the response body toolbar in `ResponsePanel`, next to the existing "Copier" button, enabled only when the body is structured JSON (same `isStructured` gate as the "Lisible" toggle).
- On click, convert the parsed response body into a real `.xlsx` workbook and save it through the existing native save-dialog flow (`saveBytes` → `pickSavePath` → `write_file`), with a browser Blob-download fallback outside Tauri.
- Flatten the JSON to a table: an array of objects becomes one row per element; a single object becomes a single row (or key/value pairs). Nested objects/arrays flatten to **dotted-key columns** (`address.city`, `_embedded.items.0.name`); the union of all keys forms the column set.
- Produce human-readable output by reusing `humanizeKey` for the bold header row and `formatMaybeDate` / `booleanLabel` / `NULL_LABEL` for cell values.
- Build the `.xlsx` client-side as a minimal OOXML zip using the already-bundled `fflate` (`zipSync`) — no new dependency, mirroring how `BrunoExportButton` zips its collection.
- Show busy state + success/error toasts, mirroring `BrunoExportButton`.

## Capabilities

### New Capabilities
- `response-export`: Export the current API response body to a human-readable Excel (`.xlsx`) file from the response panel — flattening, humanized headers, save-dialog integration, and platform fallback.

### Modified Capabilities
<!-- None: this adds a new, self-contained capability; the request-builder and response-rendering behavior is unchanged. -->

## Impact

- **New code**: `lib/xlsx.ts` (JSON→rows flattening + minimal OOXML `.xlsx` writer via fflate) and `components/ResponseExportButton.tsx` (the toolbar button).
- **Modified**: `components/ResponsePanel.tsx` — mount the button in the `BodyView` toolbar, passing `parsedBody` and a default filename derived from the endpoint/API.
- **Reused unchanged**: `lib/exporter.ts` (`saveBytes`), `lib/dialog.ts` (`SaveFilter`), `lib/humanize.ts` (`humanizeKey`, `formatMaybeDate`, `booleanLabel`, `NULL_LABEL`), `lib/platform.ts` (`isTauri`), `fflate`.
- **No changes** to Rust (`write_file` already writes arbitrary paths) or `src-tauri/capabilities/default.json` (dialog/fs permissions already cover this).
- **Dependencies**: none added.

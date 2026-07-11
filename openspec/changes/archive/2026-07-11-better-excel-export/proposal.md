## Why

The Excel export writes columns in **first-seen key order** — whatever order the
server serialized the JSON — so nested object fields scatter across the sheet and
two records with different keys produce a non-deterministic layout. A product
owner opening the file has to hunt for the field they care about. Ordering the
columns predictably makes the export scannable without touching any of the
generation, formatting, or save machinery.

## What Changes

- Order the flattened export columns as: **identity/key fields first**
  (`id`, `name`/`nom`, `code`, …), then **everything else alphabetically**.
- **Group nested fields under their parent** so all `address.*` columns stay
  contiguous instead of scattering.
- Keep **array items in index order** (`.2` before `.10`), not lexical order.
- Make the column layout **deterministic** regardless of per-record key
  differences (sort the union, not first-seen order).
- No change to which columns appear, header humanization, cell formatting, the
  export button, or the save flow.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `response-export`: the "Excel workbook generation" requirement changes the
  column *ordering* contract — from the first-seen union of flattened keys to an
  identity-first, then alphabetical order with nested groups contiguous and array
  indices in numeric order. The set of columns is unchanged.

## Impact

- Code: `lib/xlsx.ts` only — a comparator added in `flattenToRows` and its doc
  comment updated. No changes to `flattenInto`, `sanitizeForExport`,
  `humanizeColumn`, `buildXlsx`, `ResponseExportButton`, or `ResponsePanel`.
- Dependencies: none (uses `String.prototype.localeCompare`).
- Behavior: purely presentational (column order in the produced `.xlsx`); no API,
  storage, or contract impact.

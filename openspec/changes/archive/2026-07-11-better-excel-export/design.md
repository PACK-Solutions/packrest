## Context

The `.xlsx` export lives entirely in `lib/xlsx.ts`. `flattenToRows(body)`
sanitizes the body, flattens each record into dotted-key cells (`flattenInto`),
and builds a `columns: string[]` union in **first-seen order**. Every downstream
stage — `sheetRows`, `sheetXml` — reads column order from that single `columns`
array and looks up each row via `row[col]`. So column order is decided in exactly
one place, and the rest of the pipeline (formatting, humanization, zipping, save
flow) is order-agnostic.

There is no test runner in the repo; the automated gates are `npm run typecheck`,
`npm run build` (static export), and `cargo check`. `flattenToRows`/`buildXlsx`
are pure and exported, so the change is independently reasoned about.

## Goals / Non-Goals

**Goals:**
- Deterministic, scannable column order: identity fields first, then A→Z.
- Nested object fields grouped contiguously under their parent.
- Array items in numeric index order (`.2` before `.10`).
- Layout independent of per-record key ordering.
- Zero change to the column set, cell formatting, header humanization, the
  export button, or the save flow.

**Non-Goals:**
- Reordering or renaming the produced columns' *content* (still dotted keys,
  still humanized in the header only).
- Configurable/user-selectable ordering.
- Changing HAL stripping, collection unwrapping, or leaf formatting.
- Multi-sheet output or column typing/width.

## Decisions

**Sort the `columns` union, not `flattenInto` insertion order.** Because output
order is read solely from `table.columns`, the whole feature is one comparator
applied after the union is built. `flattenInto`'s emission order stays untouched.
_Alternative:_ sort keys inside `flattenInto` before recursing — rejected: it
only orders within a single record and doesn't make the cross-record union
deterministic, so `columns` would still need sorting anyway. One sort is simpler
and is the single source of truth.

**Two-tier comparator: identity rank, then locale compare.**
- `columnRank(col)` maps a column to a priority index by its **first path
  segment** (`col.split(".")[0].toLowerCase()`) against a small
  `PRIORITY_KEYS = ["id","name","nom","code","label","libelle","libellé","title","titre"]`.
  Keying on the first segment pins only genuine top-level identity fields — a
  nested `customer.id` is not promoted.
- Equal rank falls back to
  `a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })` on the
  full dotted path. This single call yields all three remaining properties:
  grouping (the `.` separator, 0x2E, sorts before digits and letters, so
  `address.city`/`address.zip` stay contiguous and ahead of `address2`/
  `addressLine`), numeric array-index order (`numeric: true`), and
  case-insensitive determinism (`sensitivity: "base"`).

_Alternative considered:_ split each path into segments and compare
segment-by-segment with explicit numeric detection. Rejected as unnecessary —
full-string `localeCompare` with `numeric: true` already produces the same
grouping and index ordering with far less code.

## Risks / Trade-offs

- **Identity list is hardcoded and French/English-biased** → keep it short and
  documented; it only affects *order*, never which columns appear, so an unlisted
  identity field simply falls into the alphabetical tier — no data loss.
- **`localeCompare` depends on the runtime's collation** → acceptable: the app
  runs in one webview (Tauri/Chromium); ordering only needs to be internally
  consistent per export, and `sensitivity: "base"` + `numeric: true` are widely
  supported.
- **A JSON key literally containing `.`** would be ambiguous against the path
  separator → pre-existing limitation of the dotted-key scheme, unchanged by this
  work.

## Migration Plan

Single pure-function change in `lib/xlsx.ts`; no data, storage, or config
migration. Rollback is reverting the comparator (columns return to first-seen
order). No feature flag needed — the change is presentational and self-contained.

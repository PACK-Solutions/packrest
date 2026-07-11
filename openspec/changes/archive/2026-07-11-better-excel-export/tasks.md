## 1. Column ordering in lib/xlsx.ts

- [x] 1.1 Add `PRIORITY_KEYS` constant and a `columnRank(col)` helper that ranks a column by its first path segment (`col.split(".")[0].toLowerCase()`), returning `PRIORITY_KEYS.length` when unmatched
- [x] 1.2 In `flattenToRows`, after the `columns` union is built, sort it by `columnRank` then `localeCompare(b, undefined, { numeric: true, sensitivity: "base" })`
- [x] 1.3 Update the `flattenToRows` doc comment: replace "first-seen order" with "identity fields first, then alphabetical with nested groups contiguous and array indices numeric"

## 2. Verification

- [x] 2.1 `npm run typecheck` passes
- [x] 2.2 `npm run build` (static export) succeeds
- [x] 2.3 Manual check: export a nested single object — `Id`/`Name` lead, remaining fields A→Z, and each nested group (`address.city`, `address.zip`) is contiguous (ahead of `address2`/`addressLine`). Verified via pure-function reproduction of `flattenToRows` ordering (`scratchpad/order-check.mjs`), the exact column list the GUI renders.
- [x] 2.4 Manual check: collection with an array field and ragged records — `items.2` orders before `items.10`, and the column layout is identical regardless of record order. Verified via the same pure-function reproduction.

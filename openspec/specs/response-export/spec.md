# response-export Specification

## Purpose
TBD - created by archiving change add-response-export. Update Purpose after archive.
## Requirements
### Requirement: Export button availability

The system SHALL present an "Exporter (Excel)" action in the response body toolbar, enabled only when the response body is structured JSON (an object or array), and disabled otherwise with an explanatory tooltip — matching the gating of the "Lisible" view toggle.

#### Scenario: Structured body enables export

- **WHEN** a request returns a JSON object or array as its body
- **THEN** the "Exporter (Excel)" button is enabled in the response body toolbar

#### Scenario: Non-structured body disables export

- **WHEN** the response body is empty, plain text, or a binary/file response
- **THEN** the "Exporter (Excel)" button is disabled and a tooltip explains that the response is not structured JSON

### Requirement: Excel workbook generation

The system SHALL convert the parsed response body into a valid Excel `.xlsx` workbook, generated entirely client-side, that opens in Excel and other spreadsheet applications without a conversion prompt. The workbook columns SHALL be ordered deterministically: identity/key fields first (`id`, `name`/`nom`, `code`, `label`/`libellé`, `title`/`titre`), then all remaining columns alphabetically, with each nested object's flattened columns grouped contiguously under their parent and array items kept in numeric index order. The set of columns is unchanged — only their order is defined.

#### Scenario: Array of objects becomes rows

- **WHEN** the response body is an array of objects
- **THEN** the workbook contains one data row per array element
- **AND** the columns are the union of the objects' (flattened) keys

#### Scenario: Single object becomes one row

- **WHEN** the response body is a single JSON object
- **THEN** the workbook contains one header row and one data row representing that object

#### Scenario: Header row is present and humanized

- **WHEN** any workbook is generated
- **THEN** the first row lists the column names formatted with `humanizeKey` (e.g. `firstName` → "First Name")
- **AND** the header row is visually distinguished (bold)

#### Scenario: Identity fields lead the columns

- **WHEN** a record has a top-level `id`, `name`/`nom`, or `code` field
- **THEN** those columns appear before the remaining columns, in that identity priority order
- **AND** a nested field such as `customer.id` is NOT treated as an identity field

#### Scenario: Remaining columns are alphabetical with nested groups contiguous

- **WHEN** the non-identity columns are ordered
- **THEN** they are sorted alphabetically, case-insensitively
- **AND** all columns of a nested object (e.g. `address.city`, `address.zip`) stay contiguous, ahead of sibling keys like `address2` or `addressLine`

#### Scenario: Array indices order numerically

- **WHEN** a flattened column set contains indexed array columns such as `items.2.name` and `items.10.name`
- **THEN** the `items.2.*` columns are ordered before the `items.10.*` columns (numeric, not lexical)

#### Scenario: Column order is independent of record order

- **WHEN** records in an array do not all share the same keys
- **THEN** the resulting column order is the same regardless of which record was seen first

### Requirement: Nested value flattening

The system SHALL flatten nested objects and arrays into dotted-key columns so that every leaf value is representable in a single cell, and SHALL never emit `[object Object]` or a JSON blob as a primary cell value for a nested structure.

#### Scenario: Nested object flattens to dotted columns

- **WHEN** a record contains a nested object such as `address: { city, zip }`
- **THEN** the workbook has columns `address.city` and `address.zip` with the corresponding leaf values

#### Scenario: Nested array flattens with index segments

- **WHEN** a record contains an array such as `_embedded.items` of objects
- **THEN** the workbook has indexed dotted columns such as `_embedded.items.0.name`

#### Scenario: Empty or ragged records

- **WHEN** records in an array do not all share the same keys
- **THEN** the column set is the union of all keys and missing cells are left blank

### Requirement: Human-readable cell formatting

The system SHALL format cell values for readability: ISO date/date-time strings are localized, booleans render as "Oui"/"Non", and null/absent values render as the shared null label — reusing the existing humanize helpers.

#### Scenario: Dates and booleans are localized

- **WHEN** a value is a strict ISO date-time or a boolean
- **THEN** the cell shows the French-localized date (via `formatMaybeDate`) or "Oui"/"Non" (via `booleanLabel`)

#### Scenario: Null renders as the shared label

- **WHEN** a value is `null` or the key is absent for a record
- **THEN** the cell renders as `NULL_LABEL` ("Aucune valeur") or is left blank consistently with other exports

### Requirement: Save flow and platform fallback

The system SHALL save the generated workbook through a native save dialog in the desktop app, defaulting to a filename derived from the API/endpoint with a `.xlsx` extension, and SHALL fall back to a browser download when Tauri APIs are unavailable. The action SHALL report progress and outcome.

#### Scenario: Save via native dialog in the desktop app

- **WHEN** the user clicks "Exporter (Excel)" in the Tauri app and picks a destination
- **THEN** the workbook is written to the chosen path via the existing `write_file` command
- **AND** a success toast is shown

#### Scenario: User cancels the save dialog

- **WHEN** the user dismisses the save dialog without choosing a path
- **THEN** no file is written and no error is raised

#### Scenario: Export failure is surfaced

- **WHEN** workbook generation or writing fails
- **THEN** an error toast is shown with the failure reason and the button returns to its idle state

#### Scenario: Browser fallback outside Tauri

- **WHEN** the app runs outside Tauri (plain browser)
- **THEN** the workbook is offered as a Blob download instead of via the native dialog


## MODIFIED Requirements

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

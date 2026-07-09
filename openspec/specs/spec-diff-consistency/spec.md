# spec-diff-consistency

## Purpose

Ensure the structural spec diff behaves consistently from its single runtime entry
point, with deterministic ordering and preserved fault tolerance.

## Requirements

### Requirement: Deterministic ordering

The diff SHALL return every result array (added/removed/changed endpoints, added/removed scopes) in a stable sorted order.

#### Scenario: Sorted output

- **WHEN** a diff produces multiple endpoint or scope entries
- **THEN** those entries are returned in sorted order

### Requirement: Fault tolerance preserved

The diff SHALL never throw on malformed input: unparseable YAML degrades to a detail-free result rather than an error.

#### Scenario: Malformed new spec

- **WHEN** the new spec YAML is unparseable
- **THEN** the result has status "updated" with empty detail arrays

#### Scenario: New API with no previous spec

- **WHEN** there is no previous spec YAML (null or empty)
- **THEN** the result has status "added" and carries the new version, with empty detail arrays

# spec-diff-consistency

## Purpose

Ensure the structural spec diff behaves consistently across every entry point — the
runtime diff and the build-time `copy-specs` CLI — by computing it from a single
shared implementation with deterministic ordering and preserved fault tolerance.

## Requirements

### Requirement: Single-source structural diff

The structural spec diff used at runtime and by the build-time `copy-specs` CLI SHALL be computed by a single shared implementation.

#### Scenario: Runtime and CLI agree for the same inputs

- **WHEN** the same previous and new spec YAML pair is diffed by the runtime and by the CLI
- **THEN** both report identical added, removed, and changed endpoints and identical added and removed scopes

### Requirement: Deterministic ordering

The diff SHALL return every result array (added/removed/changed endpoints, added/removed scopes) in a stable sorted order, regardless of entry point.

#### Scenario: Sorted output from both entry points

- **WHEN** a diff produces multiple endpoint or scope entries
- **THEN** those entries are returned in sorted order from both the runtime and the CLI

### Requirement: Fault tolerance preserved

The diff SHALL never throw on malformed input: unparseable YAML degrades to a detail-free result rather than an error.

#### Scenario: Malformed new spec

- **WHEN** the new spec YAML is unparseable
- **THEN** the result has status "updated" with empty detail arrays

#### Scenario: New API with no previous spec

- **WHEN** there is no previous spec YAML (null or empty)
- **THEN** the result has status "added" and carries the new version, with empty detail arrays

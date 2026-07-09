## REMOVED Requirements

### Requirement: Single-source structural diff

**Reason**: The build-time `copy-specs` CLI is removed together with the bundled spec seed, leaving a single runtime entry point. "One implementation shared across two entry points" no longer applies — there is only one.
**Migration**: None. The runtime diff is unchanged; it is now the sole implementation, inlined in `lib/spec-diff.ts`.

## MODIFIED Requirements

### Requirement: Deterministic ordering

The diff SHALL return every result array (added/removed/changed endpoints, added/removed scopes) in a stable sorted order.

#### Scenario: Sorted output

- **WHEN** a diff produces multiple endpoint or scope entries
- **THEN** those entries are returned in sorted order

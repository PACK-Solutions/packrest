## ADDED Requirements

### Requirement: Multi-request import browsing

The system SHALL preserve an imported Bruno collection for the duration of the session so that the user can open multiple requests from a single import without re-importing the file.

#### Scenario: Open a second request after opening the first

- **WHEN** the user imports a collection, opens one request in the builder, then navigates back to the collections page
- **THEN** the imported collection list is still displayed
- **AND** the user can open a different request without re-importing

#### Scenario: Import replaces the previous session collection

- **WHEN** the user imports a new file while a collection is already restored
- **THEN** the newly imported collection replaces the previous one in the list and in session persistence

#### Scenario: Persistence is session-scoped, not written to storage

- **WHEN** the application is closed and reopened
- **THEN** no previously imported collection is shown (import remains ephemeral across app restarts)

### Requirement: OAuth2 scope round-trip

The system SHALL preserve the OAuth2 scopes associated with a request across export and import, so a recipient opening an imported request starts with the correct scopes selected.

#### Scenario: Import recovers collection-level scopes

- **WHEN** a Bruno collection whose `opencollection.yml` declares an OAuth2 `scope` is imported and a request is opened
- **THEN** the builder pre-selects those scopes, limited to the scopes the matched operation actually declares

#### Scenario: Import recovers request-level scopes

- **WHEN** an imported request file carries its own OAuth2 auth block with a `scope`
- **THEN** the request-level scopes take precedence over collection-level scopes for that request

#### Scenario: Single-request export carries selected scopes

- **WHEN** the user exports the current request as a single Bruno `.yml`
- **THEN** the exported file records the currently selected scopes in a request-level OAuth2 auth block

#### Scenario: Unknown scopes are ignored

- **WHEN** an imported request declares a scope the matched operation does not offer
- **THEN** that scope is not selected and no error is raised

### Requirement: API-scoped request matching

The system SHALL match an imported request to a spec endpoint within the request's originating API before falling back to a global match, so that endpoints shared across APIs resolve to the correct API.

#### Scenario: Zip import scopes matching to its directory API

- **WHEN** a request is imported from a zip whose top-level directory names an API that is loaded
- **THEN** the request is matched against that API's endpoints first

#### Scenario: Single-file import uses request tags for the API

- **WHEN** a single request file is imported that carries an API identifier in its `tags`
- **THEN** matching is scoped to that API first

#### Scenario: Ambiguous cross-API match is surfaced, not silently resolved

- **WHEN** no originating API can be derived and the same method+path exists in more than one loaded API
- **THEN** the request is not silently matched to the first API
- **AND** the user is shown that the match is ambiguous

#### Scenario: Global fallback when no API context

- **WHEN** no originating API can be derived and exactly one loaded API contains the method+path
- **THEN** the request is matched to that API

### Requirement: Guidance for unrecognized imports

The system SHALL explain why imported requests are unmatched and, when the originating API is known but not loaded, direct the user to obtain that spec.

#### Scenario: Originating API not loaded

- **WHEN** an import yields no matched requests and the derived API identifier is not among the loaded specs
- **THEN** the user is shown a hint identifying the missing API and pointing to spec sync/selection

#### Scenario: Zero matches without a derivable API

- **WHEN** an import yields no matched requests and no originating API can be derived
- **THEN** the user is shown a general explanation that no endpoint in the loaded specs matched the imported requests

#### Scenario: Partial match still lists everything

- **WHEN** an import yields some matched and some unmatched requests
- **THEN** all requests are listed, matched ones are openable, and unmatched ones remain marked as unrecognized

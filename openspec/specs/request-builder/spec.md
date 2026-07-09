# request-builder Specification

## Purpose

The observable request-building contract: acquiring an OAuth2 client-credentials token for selected scopes, composing and executing JSON or multipart/form-data requests with their response/error/running/uploading states, navigating HAL `_links` (follow, back, jump, return to origin), and exporting the current request as a curl command or Bruno request.

## Requirements

### Requirement: Token acquisition

The request builder SHALL fetch an OAuth2 client-credentials token for the currently selected scopes and surface the in-flight, success, and error states to the user.

#### Scenario: Get a token with selected scopes

- **WHEN** the user requests a token with one or more scopes selected
- **THEN** a client-credentials token is fetched for exactly those scopes
- **AND** on success the token is stored and its status is shown

#### Scenario: Token request fails

- **WHEN** the token request returns an error
- **THEN** the error is surfaced to the user
- **AND** no token is stored

### Requirement: Request execution

The request builder SHALL compose and send the configured request — JSON body or multipart/form-data — and render the resulting response, error, running, and uploading states.

#### Scenario: Run a JSON request

- **WHEN** the user runs a request with a JSON body
- **THEN** the request is sent with the composed URL, headers, and body
- **AND** the response panel is populated with the result

#### Scenario: Run a multipart request with a file

- **WHEN** the user runs a request whose body includes an uploaded file
- **THEN** the request is sent as multipart/form-data carrying that file
- **AND** the uploading state is reflected while the upload is in progress

### Requirement: HAL navigation

The request builder SHALL follow a HAL `_links` URL, support navigating back and jumping within the follow stack, and support returning to the original operation.

#### Scenario: Follow a link then navigate back

- **WHEN** the user follows a `_links` URL and then navigates back
- **THEN** the builder restores the state that preceded following the link

#### Scenario: Jump to an earlier follow-stack entry

- **WHEN** the user jumps to an earlier entry in the follow stack
- **THEN** the builder restores that entry's state and truncates the stack after it

### Requirement: curl and Bruno export

The request builder SHALL copy an equivalent curl command and export the current request as a Bruno request, both reflecting the current inputs and selected scopes.

#### Scenario: Copy curl for a multipart request

- **WHEN** the user copies the curl command for a multipart request
- **THEN** the command emits `-F` flags for the form fields and files (not `--data-raw`)

#### Scenario: Export the current request as Bruno

- **WHEN** the user exports the current request as Bruno
- **THEN** the exported request reflects the current method, URL, headers, body, and selected scopes

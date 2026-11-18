# Spec Delta

## ADDED Requirements

### Requirement: Draft restoration on the endpoint page

The standalone endpoint page SHALL restore the user's last input for an operation — path and query params, JSON body and custom headers — when the user returns to that operation, including after the application restarts. Files picked for a multipart body, the response and the selected scopes are not restored.

#### Scenario: Return after looking up an id elsewhere

- **WHEN** the user fills part of the « createPremium » form, opens « listFunds » in the same window, then navigates back to « createPremium »
- **THEN** the params, body fields and custom headers show exactly what the user had typed

#### Scenario: Restore after an application restart

- **WHEN** the user types into an operation's form, closes the application, reopens it and opens that operation
- **THEN** the form shows the input as it was a moment before the application was closed

#### Scenario: Files are not restored

- **WHEN** the user returns to a multipart operation where a file had been picked
- **THEN** the metadata fields are restored and the file input is empty

#### Scenario: Untouched operation opens empty

- **WHEN** the user opens an operation whose form was never edited, or whose draft was reset
- **THEN** every param and body field starts empty, as defined by the contract

### Requirement: Restored draft is announced

When an operation's form is restored from a draft, the endpoint page SHALL tell the user so, showing when the draft was last edited, so a restored value is never mistaken for a contract default.

#### Scenario: Banner on a restored form

- **WHEN** the endpoint page opens an operation that has a saved draft
- **THEN** a banner states that the previous input was restored and when it was last edited

#### Scenario: Draft typed on another environment

- **WHEN** the endpoint page restores a draft that was last edited while a different environment was selected
- **THEN** the banner also names the environment the draft was typed on

#### Scenario: No banner on an empty form

- **WHEN** the endpoint page opens an operation with no saved draft
- **THEN** no restoration banner is shown

### Requirement: Draft reset

The endpoint page SHALL let the user discard an operation's draft, returning its form — params, body, custom headers and picked files — to the empty state, and the discarded draft SHALL NOT be restored on a later visit.

#### Scenario: Reset a restored form

- **WHEN** the user activates « Réinitialiser » on a restored form
- **THEN** every param, body field, custom header and picked file is cleared
- **AND** the banner disappears
- **AND** reopening the operation later shows an empty form

### Requirement: Import takes precedence over a draft

When a request imported from a Bruno collection is opened on an operation that has a saved draft, the system SHALL discard that draft and show the imported request unmerged.

#### Scenario: Import onto an operation with a draft

- **WHEN** the user has a draft for « createContract » and opens an imported request matched to « createContract » from the collections page
- **THEN** the form shows only the imported params, headers and body
- **AND** no restoration banner is shown

# parcours-semi-auto Specification

## Purpose
Describes how the semi-automatic mode of the guided parcours pre-fills each step's form with the same plausible, contract-derived request the automatic mode would send, so the user only reviews and executes.

## Requirements

### Requirement: Pre-fill is derived from the step's own contract

In semi-automatic mode, the system SHALL pre-fill a step's form only once that step's endpoint (synced spec and operation) has been resolved for that step, and the pre-filled body SHALL include every required field the step's request schema defines, valued from the parcours context and generated sample data.

#### Scenario: Address step after the person is created

- **WHEN** the user executes « Créer la personne » in semi-automatic mode and the parcours advances to « Adresse principale »
- **THEN** the form shows the person_id and address_type path params
- **AND** the body shows line1, postal_code, city and country_code filled with plausible values

#### Scenario: Bank account step

- **WHEN** the parcours advances to « Compte bancaire » in semi-automatic mode
- **THEN** the body shows every field the bank-account creation schema requires (holder name, IBAN, BIC, currency, validity start date) filled with plausible values

#### Scenario: Switching to semi-automatic while the active step is still resolving

- **WHEN** the user selects the semi-automatic mode before the active step's endpoint has finished resolving
- **THEN** the form is pre-filled with the full contract-derived body once the resolution completes, not with the path params alone

### Requirement: A step is pre-filled at most once, with its final draft

The system SHALL pre-fill a given step at most once per semi-automatic session, and SHALL NOT consume that single pre-fill on a draft built before the step's endpoint resolution settled, so a later visit never overwrites the user's edits or a deliberate clear.

#### Scenario: Returning to an already pre-filled step

- **WHEN** the user edits a pre-filled step, navigates away, and comes back
- **THEN** the form shows the user's edits, not a fresh pre-fill

#### Scenario: Fast step change does not lock in an empty body

- **WHEN** the parcours advances to a new step while the previous step's endpoint resolution is still the latest one available
- **THEN** no pre-fill is recorded for the new step until its own resolution completes

### Requirement: Pre-fill without a contract when the spec cannot be loaded

When a step's endpoint resolution completes without a usable contract (spec not synced or operation missing), the system SHALL still pre-fill the step with the values the parcours context and the step's business-rule overrides supply.

#### Scenario: Unsynced API

- **WHEN** the active step's API has no synced spec and the user is in semi-automatic mode
- **THEN** the form is pre-filled with the context path params and any business-rule override values
- **AND** the step is marked as pre-filled

# Spec Delta

## Purpose

Lets users reuse the ids of resources they created or listed by picking them directly in the request form's id inputs, instead of copying them between windows.

## ADDED Requirements

### Requirement: Created ids are collected without duplicates

The system SHALL record the `id` returned by a 2xx POST that creates a resource, keeping the 5 most recent per API, and SHALL NOT add an entry when the returned id equals one of the request's own path params or is already collected for that API.

#### Scenario: Creating a contract

- **WHEN** the user runs « createContract » and it returns 201 with an `id`
- **THEN** that id is collected under the contract API, labelled with the operation, newest first

#### Scenario: Creating a person

- **WHEN** the user runs « createIndividual » and the response carries `last_name` and `first_name`
- **THEN** the entry also shows « <last_name> <first_name> »

#### Scenario: Submitting the same contract

- **WHEN** the user then runs « submitContract » for that contract and it returns 2xx with the same `id`
- **THEN** no new entry is added

#### Scenario: More than five creations

- **WHEN** a sixth resource is created on the same API
- **THEN** the oldest of that API's created ids is dropped

### Requirement: Ids created in the parcours are collected and marked

The system SHALL collect the ids created by the parcours — by its automatic run, by the form of each step whatever the mode, and by its documents step — under the same rules as the request tester, and SHALL show them with a « Parcours » badge in the picker and the topbar collector.

#### Scenario: Automatic run

- **WHEN** the parcours auto-run creates the person and the contract
- **THEN** both ids are collected, each shown with a « Parcours » badge

#### Scenario: Request tester

- **WHEN** the user creates a contract from the endpoint page
- **THEN** its entry has no badge

### Requirement: Ids seen in list responses are collected

The system SHALL record the items of a 2xx GET on a collection endpoint (a path ending in a static segment, whose body is a root array or a HAL `_embedded` collection) — each item's `id` with a readable label taken from the item, or no label when nothing obvious names it (the id is then shown alone) — keeping the 20 most recent per list operation, without duplicates.

#### Scenario: Listing funds

- **WHEN** the user runs « listFunds » and it returns a collection of funds
- **THEN** each fund's id is collected under that operation, labelled with its name (or ISIN)

#### Scenario: Listing individuals

- **WHEN** the user runs « listIndividuals »
- **THEN** each person's id is collected with a label made of their last and first name

#### Scenario: Single-resource GET

- **WHEN** the user runs a GET whose path ends with a path param (e.g. « getContractById »)
- **THEN** nothing is recorded as seen

#### Scenario: Single object on a static path

- **WHEN** the user runs « getOneTimePremiumOptions », which returns one object carrying a `compartments` array
- **THEN** nothing is recorded as seen

#### Scenario: Large list

- **WHEN** a list operation returns more than 20 items
- **THEN** only the first 20 items of that response are kept for that operation, replacing its older entries beyond the cap

### Requirement: Id inputs offer a picker

Every id input of the request form — a writable body string leaf or a path param, whose schema is `format: uuid` or whose name ends in `_id` — SHALL show a picker button next to the input, and the input SHALL remain editable as free text.

#### Scenario: Path param

- **WHEN** the user opens « createPremium »
- **THEN** the `contract_id` path param shows a picker button next to its input

#### Scenario: Body field without a uuid format

- **WHEN** the body has a `payment_method_id` string with no `format`
- **THEN** that field also shows the picker button

#### Scenario: Typing still works

- **WHEN** the user pastes an id into an input that has a picker
- **THEN** the pasted value is used as is

#### Scenario: Field already backed by an option list

- **WHEN** a field is rendered as an option list supplied by the guided parcours (e.g. `fund_id` in « Versement initial »)
- **THEN** that field keeps its option list and shows no picker button

### Requirement: Picking an id

The picker SHALL list all collected ids — created and seen, except the ids of a list reserved to another input (see « The product list is fetched by the picker ») — grouped by API then by source operation, the form's own API first, each entry showing its label, a shortened id and when it was collected, searchable by label, id or operation; choosing an entry SHALL set the input to that id.

#### Scenario: Pick a fund in a premium body

- **WHEN** the user has run « listFunds », opens the picker on `allocations.funds[0].fund_id` in « createPremium » and searches « euro »
- **THEN** the matching funds from « listFunds » are listed with their names
- **AND** choosing one sets that field to the fund's id

#### Scenario: Nothing collected yet

- **WHEN** the user opens a picker while no id has been collected
- **THEN** the picker explains that ids appear after running a creation (POST) or a list (GET)

### Requirement: The product list is fetched by the picker

The picker on a `product_id` input SHALL fetch « listProducts » itself when no product id has been collected yet, keep its items as that operation's seen ids (persisted, so later pickers reuse them without a call), SHALL offer those ids on `product_id` inputs only and nothing else there, and SHALL offer a refresh that replaces them with the current list.

#### Scenario: First opening

- **WHEN** the user opens the picker on `product_id` in « createContract » and « listProducts » was never run
- **THEN** the picker fetches the products and lists them alone, labelled with their names

#### Scenario: Later openings

- **WHEN** the products were already collected
- **THEN** the picker lists them without calling the API

#### Scenario: Products stay on product_id

- **WHEN** the products were collected and the user opens the picker on `subscriber_id`
- **THEN** no product is listed

#### Scenario: Only products on product_id

- **WHEN** persons and contracts were collected and the user opens the picker on `product_id`
- **THEN** only the products are listed

#### Scenario: Refresh

- **WHEN** the user activates « Recharger les produits »
- **THEN** the product entries are replaced by the current list, and a failure is shown in the picker

### Requirement: Clearing collected ids

The topbar collector's « Tout vider » SHALL clear both the created and the seen ids.

#### Scenario: Clear everything

- **WHEN** the user activates « Tout vider » in the topbar collector
- **THEN** every picker shows the empty state afterwards

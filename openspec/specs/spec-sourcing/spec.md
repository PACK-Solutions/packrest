# spec-sourcing

## Purpose

Define where OpenAPI specs come from: exclusively a GitLab release (primary) or a
user-configured local source directory (fallback), written to the writable app-data
spec store. No specs are bundled into the build or seeded on first launch.

## Requirements

### Requirement: Specs originate only from GitLab or a local directory

The app SHALL obtain OpenAPI specs exclusively from a GitLab release (primary) or a user-configured local source directory (fallback). No specs SHALL be bundled into the application build or seeded on first launch.

#### Scenario: Sync from GitLab

- **WHEN** the user syncs a GitLab release that contains a recognized bundle
- **THEN** each OpenAPI bundle is written to the writable app-data spec store and becomes the source the app reads

#### Scenario: Sync from a local directory

- **WHEN** the user syncs from a configured local source directory
- **THEN** each `<api>/v1/openapi.bundle.yaml` found there is written to the writable app-data spec store

#### Scenario: No bundled seed ships with the app

- **WHEN** a freshly built application is installed
- **THEN** it carries no bundled spec files and performs no first-launch seeding

### Requirement: Empty state until first sync

On first launch, before any sync, the app SHALL start with no specs and present a state that directs the user to sync rather than an error.

#### Scenario: First launch with an empty spec store

- **WHEN** the app opens and the writable spec store contains no specs
- **THEN** the API list is empty and the UI shows guidance to synchronize specs from GitLab or a local directory

### Requirement: App-data store is the only runtime source

The app SHALL read specs only from the writable app-data spec store, populated by sync. Outside the Tauri runtime, where no writable store exists, the API list SHALL be empty.

#### Scenario: Reading specs at runtime

- **WHEN** the app lists or loads an API
- **THEN** it reads from the writable app-data spec store and from no bundled or static fallback

#### Scenario: Running outside Tauri

- **WHEN** the frontend runs outside the Tauri runtime (plain browser)
- **THEN** the API list is empty because there is no writable store and no bundled fallback

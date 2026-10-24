# AT-03 Asset Registry Design

**Status:** Draft for review
**Scope:** AT-03, issue #39
**Sources:** `docs/local/specs/spec-004--asset-topology-module.md`, `docs/shared/business/01-infrastructure-asset-management.md`, `.scratch/ticket-drafts/asset-topology/tickets.md`

## Goal

Implement the first persistent Asset registry slice for physical compute Nodes. IT Admins can register, read, and update descriptive Asset information even when manufacturer serial details or a Model are not available. Every Asset receives a stable canonical UUID, starts in the `ACTIVE` lifecycle state, and has no placement. Placement and Agent binding remain separate concerns owned by Asset Location and Agent Management.

## Current repository state

- The Asset & Topology domain already has an `Asset` entity with name, Type and Model references, optional serial number, registration validation, and rename behavior. It does not currently persist Assets, define Asset lifecycle state, or expose registry operations.
- AT-01 provides the module composition, Mongo migration registry integration, Audit Fact/Outbox patterns, HTTP error conventions, and colocated `__tests__` convention.
- The current Asset & Topology consumer contract groups Asset, Rack, Room-map, and maintenance operations and has no provider. AT-03 will split out and provide the Asset query so consumers can use it now; later tickets can add the Rack and Room-map queries without delaying Asset reads.
- Existing application-generated identities use `node:crypto` `randomUUID()`.
- IAM defines the `asset:read` and `asset:manage` permissions. AT-01 chose the existing Flow 1 mutation policy of requiring both IT Admin role and `asset:manage`; AT-03 will follow it.
- Node Type is required bootstrap/reference data. Optional Models are read-only references and no Model CRUD is part of Flow 1.

## Proposed design

### Domain and application

- Extend `Asset` with `AssetLifecycleState` and register every new Asset in `ACTIVE` state. Asset identity is generated as a UUID in the application layer and remains unchanged by descriptive updates.
- Keep placement out of the Asset entity's registry write model. A new Asset is unassigned because it has no active Asset Location; do not persist an `UNASSIGNED` lifecycle state or duplicate placement state.
- Treat Asset Type as required classification and immutable after registration. Allow descriptive updates to name, optional Model reference, and optional manufacturer serial number while preserving the canonical ID and Type. When Model changes, require the new Model to exist and belong to the Asset's immutable Type.
- Split application responsibilities into separate files for registration, Asset queries, and descriptive updates. Keep each use case cohesive rather than accumulating unrelated flows in one service.
- Validate optional Model references through an Asset & Topology-owned catalog read port. A Model must exist and its `assetTypeId` must match the Asset Type. The Type and Model catalog have no Flow 1 write endpoints.

### Catalog bootstrap and persistence

- Add an Asset & Topology-owned Mongo catalog representation for Asset Types and Models, separate from Asset records. Seed the stable Node Type through an idempotent Mongo migration. Catalog records are read-only through Flow 1.
- Treat Models as bootstrap/migration-provisioned reference data. AT-03 does not require a Model record to be seeded; registration without a Model must work. If a Model is supplied, the catalog lookup must find it and confirm its Type.
- Persist Assets in an Asset & Topology-owned Mongo collection with a unique canonical ID, immutable Type reference, optional Model and serial fields, lifecycle state, timestamps, and an Audit sequence. Do not add a uniqueness constraint to serial number because the spec does not treat it as globally unique.
- Add indexes needed for canonical ID lookups and common listing filters only where the implemented query behavior requires them.

### HTTP and authorization

- Add the Flow 1 Asset registry under `/api/v1/asset-topology/assets`: register an Asset, retrieve one Asset by canonical ID, update its descriptive fields, and list Assets with minimal cursor pagination.
- The list endpoint has only `cursor` and `page_size` query parameters, uses opaque cursors over stable Asset-ID ordering, defaults to 20 records, and caps pages at 100, following the existing HTTP pagination conventions. It has no filters in AT-03; filtering can be added with a concrete use case later.
- Validate request bodies and IDs at the presentation boundary and map domain/not-found errors using the platform's existing Problem Details and response conventions.
- Protect reads with `asset:read`. Require both IT Admin role and `asset:manage` for register/update operations, consistent with AT-01.
- Keep the controller focused on HTTP validation, use-case dispatch, response mapping, and error translation. If a controller or use-case file approaches 350–400 lines or takes on multiple responsibilities, split it into cohesive smaller files (for example, separate registration and query controllers/use cases).
- Describe routes, DTOs, authorization, and response/error behavior in `api/v1/asset-topology.yaml`.

### Public consumer contract

- Implement and provide a focused Asset query contract that returns canonical ID, name, Type ID, lifecycle state, and `currentPlacement: null` while no active placement exists. This provider is available in AT-03 and can be consumed by Agent Management without waiting for Rack or Room-map queries.
- Keep Dashboard REST DTOs separate from module-to-module contracts. Separate the Asset query contract/token from the broader Rack and Room-map query contracts so each provider exposes only implemented behavior. AT-04 can add its Rack query when ready; do not make the working Asset query depend on that later provider.

### Audit and transaction consistency

- Register and material descriptive updates write Asset state and append an `audit.fact` Business Fact to the existing Outbox in the same Unit of Work transaction.
- Audit facts identify the actor, `asset-topology` producer/source, action, canonical Asset resource ID, request context when present, event time, and allowlisted scalar changes. Reuse the existing Audit consumer/store; do not add a separate Audit store.
- Allocate a monotonically increasing sequence for each Asset within the transaction. Read-only operations and no-op updates do not emit Audit facts.
- The Node Type bootstrap migration is initial reference-data provisioning and does not emit an Audit Fact.

## Acceptance mapping

1. IT Admin can register an Asset with a required name and Node Type; Model and manufacturer serial number are optional.
2. Generated canonical UUID identity is stable. New records have lifecycle state `ACTIVE` and no active placement.
3. A supplied Model must exist in the owned read-only catalog and match the Asset Type.
4. A fresh environment contains the Node Type through the existing Mongo migration mechanism.
5. Descriptive updates preserve the Asset ID and Type.
6. Dashboard REST reads and the internal Asset query expose the canonical Asset reference without claiming that the Asset is placed or Agent-bound.
7. Asset listing uses opaque cursor pagination with a default page size of 20 and a maximum of 100; it has no filters in AT-03.
8. Authorization, validation, persistence, OpenAPI, and Audit behavior have focused tests; material writes and Audit Outbox facts are atomic.

## Explicitly deferred

- Type or Model catalog CRUD and catalog management UI.
- Asset placement history, Rack Unit assignment, QR mappings and label generation.
- Lifecycle transitions to maintenance or retirement, and Agent binding coordination.
- Model import or synchronization from an external system; this design assumes catalog data is supplied through Asset & Topology bootstrap/migrations.
- Rack and Room-map consumer query providers; those can be added when their owning implementations are ready.

## Review notes

- UUID is chosen because it matches the repository's generated identity convention and gives consumers a stable opaque canonical reference. No human-readable sequential ID format is introduced.
- Bootstrap/migration-provisioned Models are an explicit assumption because no external Model owner/contract is defined in the current scope. This assumption should be revised if a catalog owner is identified before implementation.
- The consumer contract is split by query responsibility so the complete Asset reference is available before the separate Rack query implementation.
- The 350–400 LOC guideline is a split trigger, not a target; cohesive responsibilities may be separated sooner when that keeps application and presentation code understandable.

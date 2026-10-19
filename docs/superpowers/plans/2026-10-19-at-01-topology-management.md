# AT-01 Topology Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and expose the default Data Center, Sites, and Rooms for Flow 1, with authorization and attributable Audit facts.

**Architecture:** Add Site and Room domain/application behavior inside Asset & Topology, backed by module-owned Mongo adapters and a registered Mongo migration for the stable default Data Center. Dashboard REST/OpenAPI remains a presentation contract separate from Asset & Topology's backend consumer contract. Site/Room writes and Audit Business Facts enter the Outbox in one Unit of Work; the Audit module consumes those facts.

**Tech Stack:** NestJS 11, TypeScript 5.9, MongoDB/Mongoose, Zod, Jest, OpenAPI YAML, platform UnitOfWork/Outbox ports.

**Spec:** `docs/superpowers/specs/2026-10-19-at-01-topology-management-design.md`; business rules in `docs/local/specs/spec-004--asset-topology-module.md` and `docs/shared/business/01-infrastructure-asset-management.md`.

## Global Constraints

- Keep domain code independent of NestJS, MongoDB, HTTP, and external SDKs.
- Cross-module collaboration uses public application contracts; no direct access to another module's repositories, services, domain models, or persistence.
- Public REST paths use `/api/v1`; update the OpenAPI source with HTTP behavior changes.
- Use existing IAM permissions `asset:read` and `asset:manage`; do not add permission codes for AT-01.
- Require `IT_ADMIN` and `asset:manage` for mutations; `asset:manage` alone may be granted to non-admin roles.
- Reuse the existing Audit mechanism; do not add a separate Audit store.
- Append Audit Business Facts to the Outbox in the same Mongo transaction as their topology writes; let the Audit consumer persist them. The existing `producer` field represents the source (`asset-topology`).
- Keep `AssetTopologyConsumerContract` unchanged and do not bind a partial provider until its Asset and Rack queries are implemented; add a code comment documenting this wiring condition.
- Keep the default Data Center read-only through Flow 1; Site-to-Data-Center and Room-to-Site references are immutable after creation.
- Do not persist Room grid cells; validate positive integer dimensions and grid snap through `RoomMap`.
- Defer Rack-placement-aware Room update integration to AT-02, which introduces persisted Rack placement.

## Review Focus

1. Duplicate or rerun of the default Data Center migration must not create another default or overwrite existing topology data.
2. Site/Room writes with a missing parent or changed parent reference must fail without partial persistence.
3. Audit Outbox failure must roll back the associated Site/Room change; Audit attribution must use the trusted actor and source from request context.
4. Invalid dimensions, grid snap, IDs, and no-op updates must follow the documented validation and Audit behavior.
5. Access with missing/insufficient permissions must fail through existing HTTP guards; no Data Center mutation endpoint may be exposed.

---

### Task 1: Site and Room domain models

**Files:**

- Create: `src/modules/asset-topology/domain/topology/data-center.ts`
- Create: `src/modules/asset-topology/domain/topology/site.ts`
- Create: `src/modules/asset-topology/domain/topology/site.spec.ts`
- Create: `src/modules/asset-topology/domain/topology/room.ts`
- Create: `src/modules/asset-topology/domain/topology/room.spec.ts`
- Modify: `src/modules/asset-topology/index.ts`

**Interfaces:**

- `DataCenterId`, `SiteId`, and `RoomId` are opaque string IDs; the default Data Center has one exported stable ID constant.
- `Site.create({ id: SiteId, name: string, dataCenterId: DataCenterId }): Site`; `Site.rename(name: string): Site` preserves ID and Data Center reference.
- `Room.create({ id: RoomId, name: string, siteId: SiteId, roomMap: RoomMap }): Room`; `Room.update({ name: string, roomMap: RoomMap }): Room` preserves ID and Site reference.
- Domain factories reject empty/whitespace names; Room receives an already-validated `RoomMap`.

- [x] **Step 1: Write failing domain tests** for stable seeded Data Center identity, name validation, Site parent immutability, Room parent immutability, and valid RoomMap composition.
- [x] **Step 2: Run the focused specs** with `pnpm exec jest --runInBand src/modules/asset-topology/domain/topology/site.spec.ts src/modules/asset-topology/domain/topology/room.spec.ts`; confirm the expected missing-module or behavior failures.
- [x] **Step 3: Implement the domain types and exports** with only the constructors/factories and update methods described above.
- [x] **Step 4: Rerun the focused specs** and existing `room-map.spec.ts`; expect all domain tests to pass.

### Task 2: Topology application ports and use cases

**Files:**

- Create: `src/modules/asset-topology/application/topology/topology-store.port.ts`
- Create: `src/modules/asset-topology/application/topology/topology-store.token.ts`
- Create: `src/modules/asset-topology/application/topology/topology-use-cases.ts`
- Create: `src/modules/asset-topology/application/topology/topology-use-cases.spec.ts`
- Reuse: `src/modules/asset-topology/contracts/asset-topology.contract.ts` for existing backend consumers; do not add Dashboard REST DTOs to it.

**Interfaces:**

- `TopologyStorePort`: `getDataCenter(id)`, `listSites(dataCenterId)`, `getSite(id)`, `saveSite(site, context)`, `listRooms(siteId)`, `getRoom(id)`, and `saveRoom(room, context)`.
- `TopologyUseCases`: `getDefaultDataCenter()`, `listSites(dataCenterId)`, `createSite(input, actor)`, `getSite(siteId)`, `updateSite(siteId, input, actor)`, `listRooms(siteId)`, `createRoom(input, actor)`, `getRoom(roomId)`, and `updateRoom(roomId, input, actor)`.
- Create/update methods run through `UnitOfWorkPort`; parent validation uses the store; update input excludes `dataCenterId` and `siteId` respectively. Mutations append an Audit Fact v2 to `OutboxWriterPort` only when material values change. The store returns/allocates a monotonic per-resource Audit sequence transactionally with each create/update.

- [x] **Step 1: Write failing use-case tests** for default Data Center retrieval, parent checks, immutable references, valid create/update, no-op update with no fact, and transactional Outbox append.
- [x] **Step 2: Run the focused spec**; confirm expected failures before implementation.
- [x] **Step 3: Implement the topology application port and use cases** with actor/source/time attribution and allowlisted scalar changes.
- [x] **Step 4: Rerun the focused spec**; verify an Outbox failure rejects the use case and leaves repository state unchanged through the Unit of Work contract.

### Task 3: Mongo persistence and default Data Center migration

**Files:**

- Create: `src/modules/asset-topology/infrastructure/mongodb/topology.schema.ts`
- Create: `src/modules/asset-topology/infrastructure/mongodb/mongo-topology.store.ts`
- Create: `src/modules/asset-topology/infrastructure/mongodb/mongo-topology.store.spec.ts`
- Create: `src/modules/asset-topology/infrastructure/mongodb/migrations/default-data-center.migration.ts`
- Create: `src/modules/asset-topology/infrastructure/mongodb/migrations/default-data-center.migration.spec.ts`
- Create: `src/modules/asset-topology/migrations.ts`
- Modify: `src/app/commands/mongo-migrations.registry.ts`

**Interfaces:**

- Export schemas/model tokens for Data Center, Site, and Room from the infrastructure folder only.
- `MongoTopologyStore` implements `TopologyStorePort`; Mongoose sessions receive the opaque `UnitOfWorkContext` only through the repository's standard transaction adapter. Persist a private `auditSequence` and increment it atomically per Site/Room resource.
- `DEFAULT_DATA_CENTER_ID` is deterministic; migration upsert filters by that ID and uses `$setOnInsert` so reapplication never overwrites user-managed data.

- [x] **Step 1: Write failing repository tests** for serialization, parent lookups, ID uniqueness, update replacement, and preserving values on rejected parent/reference changes.
- [x] **Step 2: Run repository specs** and verify they fail on missing persistence behavior.
- [x] **Step 3: Implement schemas, mappers, repository methods, and the idempotent default Data Center migration**; register the module-owned migration with the application registry.
- [x] **Step 4: Rerun repository and migration specs**; verify two migration executions leave exactly one default record and preserve its existing values.

### Task 4: Dashboard REST and OpenAPI

**Files:**

- Create: `src/modules/asset-topology/presentation/topology.controller.ts`
- Create: `src/modules/asset-topology/presentation/topology.schemas.ts`
- Create: `src/modules/asset-topology/presentation/topology.controller.spec.ts`
- Create: `api/v1/asset-topology.yaml`
- Modify: `src/modules/asset-topology/asset-topology.module.ts`

**Interfaces:**

- Routes under `/api/v1/asset-topology`: `GET /data-centers/default`; `GET|POST /data-centers/{dataCenterId}/sites`; `GET|PATCH /sites/{siteId}`; `GET|POST /sites/{siteId}/rooms`; `GET|PATCH /rooms/{roomId}`.
- No Data Center create/update route. Request schemas include no parent IDs on update DTOs.
- Read routes require `asset:read`; mutations require `IT_ADMIN` plus `asset:manage`; responses/errors use the established API envelope and Problem Details mapping.

- [x] **Step 1: Write failing controller tests** for route behavior, authorization, validation failures, immutable parent DTOs, standard errors, and absence of Data Center mutation routes.
- [x] **Step 2: Run controller specs** and confirm the expected failing behavior.
- [x] **Step 3: Implement controller, schemas, and module wiring**; document all public operations and schemas in OpenAPI.
- [x] **Step 3a: Add a source comment** beside the backend consumer-contract registration point documenting that `AssetTopologyConsumerContract` must not be bound until Asset and Rack query implementations are complete; do not export Dashboard REST DTOs through that contract.
- [x] **Step 4: Run focused controller tests and OpenAPI validation** using the repository's configured contract tooling.

### Task 5: Integration wiring and verification

**Files:**

- Modify: `src/modules/asset-topology/asset-topology.module.ts`
- Modify: `src/app/core.module.ts`
- Modify: `docs/local/specs/spec-004--asset-topology-module.md` only if implementation reveals a contract clarification needed for accuracy.

- [ ] **Step 1: Add integration coverage** proving a Site/Room material update stores state and one Audit Business Fact in the Outbox transaction, then Audit consumes it through existing wiring.
- [ ] **Step 2: Run focused tests** for all Asset & Topology domain, application, persistence, and presentation specs.
- [ ] **Step 3: Run `pnpm typecheck`, `pnpm build`, and `pnpm format:check`;** report unavailable infrastructure or environment failures accurately.
- [ ] **Step 4: Review scoped diffs** for Data Center mutation exposure, parent mutability, direct Audit persistence access, and unscoped files.

# Room Walkway Cells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let IT Admins reserve Room grid cells as walkways, prevent Rack overlap with those cells under concurrent layout changes, and expose the resulting Room map and capacity through backend contracts.

**Architecture:** Store the sparse walkway set and layout revision on Room. Use a conditional Room revision update in the existing Mongo transaction as the serialization point for walkway, dimension, and Rack location mutations. Extend the existing Room-map query and HTTP contract; preserve Rack Location as the source of Rack placement history and the existing Audit mechanism for attribution.

**Tech Stack:** TypeScript, NestJS, Zod, Jest, Mongoose, MongoDB transactions, OpenAPI 3.1.

**Spec:** `.scratch/designs/asset-topology/room-walkway-cells.md`, `docs/local/specs/spec-004--asset-topology-module.md`, `docs/shared/business/01-infrastructure-asset-management.md`.

## Global Constraints

- Domain code stays independent of NestJS, MongoDB, and other frameworks.
- Grid cell counts use only full cells: `floor(dimension_mm / grid_snap_mm)`.
- One Rack occupies exactly one logical Room cell; no Rack width/depth is added.
- Walkways reserve cells only; no aisle entity, connectivity, width, or navigation is introduced.
- Rack placement and Room layout rules are enforced by the backend, even when clients render the Room map.
- Audit uses the existing Audit Fact/Outbox mechanism; no Audit store is added.
- Public HTTP contract changes are reflected in `api/v1/asset-topology.yaml`.
- Preserve unrelated worktree changes and do not modify Dashboard/frontend code.

## Review Focus

1. Two requests use one Room revision concurrently — one commits; the stale one receives `ROOM_LAYOUT_REVISION_CONFLICT` and cannot leave a partial Rack location or walkway update. Cover with transaction/store and use-case tests.
2. Cross-Room Rack move has stale source or destination revision — the move rolls back entirely. Cover both stale-side cases.
3. A walkway list contains duplicate, out-of-bounds, or Rack-occupied coordinates — reject the whole request and preserve Room/Audit state. Cover domain and use-case validation.
4. Room dimension/snap changes interact with existing Rack and walkway cells — reject only changes that violate the approved rules. Cover width/depth, snap-with-occupancy, and valid dimension change cases.
5. Identical walkway sets in different request order — no-op with unchanged revision and no Audit Fact; query capacity and `location_label` remain deterministic. Cover canonicalization, audit, and query tests.

---

### Task 1: Model Room walkway cells and enforce Rack cell eligibility

**Files:**
- Create: `src/modules/asset-topology/domain/topology/room-map-cell.ts`
- Modify: `src/modules/asset-topology/domain/topology/room-map.ts`
- Modify: `src/modules/asset-topology/domain/topology/rack-layout-policy.ts`
- Modify: `src/modules/asset-topology/domain/topology/room-map-change-policy.ts`
- Test: `src/modules/asset-topology/domain/topology/__tests__/room-map.spec.ts`
- Test: `src/modules/asset-topology/domain/topology/__tests__/rack-layout-policy.spec.ts`
- Test: `src/modules/asset-topology/domain/topology/__tests__/room-map-change-policy.spec.ts`

**Interfaces:**
- Produce `RoomMapCell { readonly column: number; readonly row: number }`.
- `RoomMap.create` accepts optional `walkwayCells`, defaults to `[]`, canonicalizes row-then-column order, and rejects duplicate/out-of-grid cells.
- `RackLayoutPolicy.validate(roomMap, candidate, otherRacksInRoom)` rejects candidates in `roomMap.walkwayCells` with code `RACK_CELL_RESERVED_AS_WALKWAY`.
- `RoomMapChangePolicy.validate` rejects a snap change when either active Rack locations or walkway cells exist, and rejects dimensions that exclude any Rack or walkway.

- [x] **Step 1: Write failing domain tests.** Verify sparse/default walkways, duplicate/out-of-bounds rejection, Rack placement onto walkway rejection, snap change rejection with walkway-only occupancy, and dimension shrink rejection for a walkway.
- [x] **Step 2: Run the three focused domain suites and confirm the new assertions fail for the expected missing behavior.**
- [x] **Step 3: Implement the RoomMap cell set and domain policies with stable DomainError codes.**
- [x] **Step 4: Re-run those suites and confirm they pass.** `jest --runInBand ...room-map... ...rack-layout-policy... ...room-map-change-policy...` → 3 suites, 16 tests passed.

### Task 2: Persist Room layout revision and provide transactional CAS

**Files:**
- Modify: `src/modules/asset-topology/domain/topology/room.ts`
- Modify: `src/modules/asset-topology/application/topology/topology-store.port.ts`
- Modify: `src/modules/asset-topology/infrastructure/mongodb/topology.schema.ts`
- Modify: `src/modules/asset-topology/infrastructure/mongodb/mongo-topology.store.ts`
- Create: `src/modules/asset-topology/infrastructure/mongodb/migrations/room-walkway-layout.migration.ts`
- Modify: `src/modules/asset-topology/migrations.ts`
- Test: Room domain, `mongo-topology.store.spec.ts`, and migration spec under their existing `__tests__/` folders.

**Interfaces:**
- `Room.layoutRevision` defaults to `0` for new Rooms and legacy documents; `Room.update` preserves it unless a layout use case supplies the advanced revision.
- Persist `walkwayCells` and `layoutRevision` on `asset_topology_rooms`. Legacy records read as `walkwayCells: []`, `layoutRevision: 0` until migrated.
- Add `TopologyStorePort.advanceRoomLayoutRevision(roomId, expectedRevision, context): Promise<Room | null>`. The Mongo adapter performs `findOneAndUpdate` filtered by both Room ID and expected revision, increments `layoutRevision`, and returns the updated Room. `null` means stale revision or missing Room.
- The CAS write is in the same `UnitOfWorkContext` as Rack Location, Room data, and Audit Fact writes.

- [x] **Step 1: Write failing tests** for legacy default mapping, walkway/revision round-trip, matching CAS increment, and stale CAS returning `null` without changing the stored revision.
- [x] **Step 2: Run topology store and migration suites; confirm the new tests fail.**
- [x] **Step 3: Implement Room revision preservation, schema fields, migration/backfill defaults, and conditional update adapter.** Migration ID must be a new immutable UTC timestamp and added in ordered migration registration.
- [x] **Step 4: Run the focused store and migration suites; confirm they pass.** `jest --runInBand ...room.spec... ...mongo-topology.store.spec... ...room-walkway-layout.migration.spec...` → 3 suites, 10 tests passed.

### Task 3: Coordinate Room and Rack use cases through layout revisions

**Files:**
- Modify: `src/modules/asset-topology/application/topology/topology-use-cases.ts`
- Modify: `src/modules/asset-topology/application/racks/rack-management.use-case.ts`
- Modify: `src/modules/asset-topology/domain/topology/room.ts`
- Test: `src/modules/asset-topology/application/topology/__tests__/topology-use-cases.spec.ts`
- Test: `src/modules/asset-topology/application/racks/__tests__/rack-management.use-case.spec.ts`

**Interfaces:**
- `UpdateRoomInput` adds `walkwayCells?: readonly RoomMapCell[]` and `expectedLayoutRevision?: number`. If any Room map field is supplied, require a revision, CAS before saving, validate all Rack/walkway cells, and return an updated Room. Name-only changes do not use or increment the layout revision.
- Rack create input requires `expectedLayoutRevision`; reserve/increment the target Room revision before validating and saving the initial Rack location.
- Rack move input requires `expectedLayoutRevision` for the destination, plus `expectedSourceLayoutRevision` only when moving to a different Room. Same-Room moves CAS one revision; cross-Room moves CAS both in one unit of work. Re-read and validate after CAS, then close/save location history atomically.
- Successful layout mutations return the resulting Room revision(s) to presentation. A no-op move or canonical-equal walkway set does not increment revisions or append Audit Facts.

- [x] **Step 1: Write use-case tests** for walkway replacement, occupied-cell rejection, stale revision, canonical no-op ordering, Rack creation on a walkway, and cross-Room source/destination revisions. Existing Room-map policy tests cover dimension guards and Rack move validation.
- [x] **Step 2: Run focused use-case suites; the initial assertions exposed occupied-walkway error precedence and invalid move fixture time.**
- [x] **Step 3: Implement revision CAS coordination and maintain existing Audit Fact behavior.** A stale Room maps to a typed conflict; cross-Room moves CAS both Room revisions in deterministic ID order inside the unit of work.
- [x] **Step 4: Run focused use-case suites and confirm they pass.** `jest --runInBand ...topology-use-cases... ...rack-management...` → 2 suites, 18 tests passed.

### Task 4: Publish Room-map and mutation contracts

**Files:**
- Modify: `src/modules/asset-topology/contracts/asset-topology.contract.ts`
- Modify: `src/modules/asset-topology/application/racks/rack-query.use-case.ts`
- Modify: `src/modules/asset-topology/presentation/topology.schemas.ts`
- Modify: `src/modules/asset-topology/presentation/topology.controller.ts`
- Modify: `src/modules/asset-topology/presentation/racks/rack.schemas.ts`
- Modify: `src/modules/asset-topology/presentation/racks/rack.controller.ts`
- Modify: `src/platform/http/errors/problem-details.mapper.ts` only if needed to retain stable feature error codes in Problem Details.
- Test: corresponding controller and query suites under `__tests__/`.
- Modify: `api/v1/asset-topology.yaml`

**Interfaces:**
- Extend `RoomMapReference` with `layoutRevision`, canonical `walkwayCells`, and calculated capacity `{ totalCells, rackCapacityCells, activeRackCount, freeRackCells }`.
- HTTP Room map exposes `layout_revision`, `walkway_cells`, `capacity`, and Rack map cells with `location_label` using spreadsheet row letters plus one-based columns.
- Room PATCH conditionally requires `expected_layout_revision` when `walkway_cells`, dimensions, or grid snap are supplied; `walkway_cells` replaces the complete set.
- Rack create takes `expected_layout_revision`; Rack move takes destination `expected_layout_revision` and source `expected_source_layout_revision` only for cross-Room moves. Mutation responses expose resulting revision(s).
- Map stale revisions and occupied/walkway conflicts to stable Problem Details codes with `409`; invalid cell coordinates/list and invalid Room geometry to stable `422` codes. Keep existing `400/403/404` conventions.

- [x] **Step 1: Add controller/query and Problem Details tests** for conditional layout revision, map output/capacity, custom conflict-code preservation, and spreadsheet row labels through `AA`; cross-Room source revision is covered at the use-case boundary.
- [x] **Step 2: Run focused suites and resolve the resulting shape and location-label assertion mismatches.**
- [x] **Step 3: Implement query/HTTP serializers and Zod schemas; update OpenAPI request/response/error schemas and status declarations.**
- [x] **Step 4: Run controller/query tests and validate the OpenAPI YAML parses.**

### Task 5: Update business/spec documentation and verify the feature

**Files:**
- Modify: `docs/local/specs/spec-004--asset-topology-module.md`
- Modify: `docs/shared/business/01-infrastructure-asset-management.md`
- Verify: `api/v1/asset-topology.yaml`
- Verify all changed module tests and scoped ESLint/TypeScript checks.

- [x] **Step 1: Update Room-map rules, functional requirements, use cases, conflict/failure behavior, query contract, and limits in the local spec.**
- [x] **Step 2: Update business flow requirements and outcomes to describe walkway reservation and available-cell capacity, without adding navigation/aisle scope.**
- [x] **Step 3: Run the full Asset & Topology Jest suites, ESLint, both TypeScript checks, and OpenAPI YAML parsing.**
- [x] **Step 4: Inspect the scoped diff and `git status --short --ignore-submodules=all`; preserve unrelated user changes.**

## Implementation Ruling

- **Ruling:** Use `expected_layout_revision` for a Rack move's destination Room and `expected_source_layout_revision` for a cross-Room source. The reviewed design requires both revisions but does not prescribe field names; this keeps same-Room requests to one token and cross-Room requests explicit. **Cost if wrong:** The move request field names may need a contract revision before Dashboard integration.

## Implementation ledger

Record each task's RED/GREEN test commands, final suite results, and any additional rulings here as the plan is executed.

- Task 1: RoomMap, RackLayoutPolicy, and RoomMapChangePolicy suites failed on the added walkway assertions, then passed 3 suites / 16 tests after domain implementation.
- Task 2: Room, MongoTopologyStore, and migration suites failed on missing revision fields/CAS, then passed 3 suites / 10 tests after persistence implementation.
- Task 3: Focused application suites passed 2 suites / 18 tests after fixing walkway error precedence and adjusting the cross-Room move fixture time.
- Task 4: The full final run passed 42 suites / 185 tests; `tsc --noEmit -p tsconfig.spec.json`, `tsc -p tsconfig.build.json --noEmit`, and CI ESLint completed with exit code 0. OpenAPI YAML parsing confirmed the Room map route is present.
- Task 5: Updated both requested specification/business-flow documents. The shared docs Git submodule metadata is not readable in this environment, so its internal Git status could not be independently inspected; the requested flow file itself was edited in place and no staging/commit was performed.

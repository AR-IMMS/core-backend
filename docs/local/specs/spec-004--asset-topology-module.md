# Asset & Topology Module Specification

**Status:** Draft for review  
**Version:** 0.2  
**Date:** 2026-10-18  
**Scope:** AR-IMMS Core backend, Asset & Topology bounded context

## 1. Purpose

Asset & Topology maintains the canonical identity and confirmed physical context of infrastructure used by AR-IMMS. It gives Agent Management, Monitoring, Incident, Maintenance, Inspection, and AR clients a stable way to refer to the same assets and locations.

This specification consolidates the agreed Flow 1 behavior and the current logical ERD direction. It does not lock final REST paths, MongoDB collection design, or implementation details that have not been reviewed.

## 2. Design principles

- Treat Asset & Topology as a P0 source of truth. Store only information with a defined owner and use.
- Keep one NestJS business module in the modular monolith. Organize it into capabilities; do not create one module per entity.
- Keep domain rules independent of NestJS, Mongoose, HTTP, and messaging.
- Other business modules reference canonical IDs and use published contracts when they need Asset & Topology data. They do not write its persistence directly.
- Preserve stable asset identity when hostname, IP, placement, Rack QR, or Agent binding changes.
- Keep Asset lifecycle separate from placement, Agent binding/connectivity, observed health, and workload/service state. The Flow 1 maintenance state is recorded on the Asset; Monitoring owns the policy for suppressing alerts during maintenance.

## 3. Scope

### 3.1 In scope

- Use the Data Center provisioned by seed/bootstrap as the root of the Flow 1 hierarchy. Admins can view it but do not create or update Data Centers through Flow 1. Manage Site → Room/Hall → Rack beneath it.
- Treat Site as the AR-IMMS concept corresponding to Building in the reference DC ERD; do not add a separate Building entity.
- Maintain a 2D Room map using physical dimensions, a generated full-cell grid, one-cell Rack coordinates, and rotation.
- Manage Rack capacity and individual Rack U positions.
- Register and maintain Asset records. The Node Asset Type is available through seed/bootstrap; an Asset Model is optional and may only reference an existing Model.
- Place, move, and unmap Assets in Rack U positions while retaining location history.
- Maintain QR identity for both Rack and Node, and support individual or bulk printable labels in both PDF and SVG.
- Retain actor, source, and timestamp attribution for material changes through the existing Audit mechanism; do not create a separate Audit store.
- Provide stable identifiers and confirmed topology/placement for other flows.

### 3.2 Out of scope

- Workload and Service registry, container/process inventory, and service dependency topology.
- Agent enrollment, credentials, heartbeat, configuration, binding ownership, unlink, and uninstall.
- Telemetry ingestion, health evaluation, alerting, and Incident lifecycle.
- Maintenance and Inspection activity workflows, checklists, findings, corrective actions, and ticket handling. Asset maintenance-state coordination follows section 5.5.
- Component-level hardware inventory such as individually tracked DIMMs, disks, NICs, and PSUs.
- Procurement, vendor lifecycle, finance, warranty management, billing, tenants, and ownership-assignment workflows unless separately approved.
- PDU, power/cooling capacity, electrical/network topology, switches, routers, storage arrays, and detailed facilities engineering.
- Region/Availability Zone/cloud hierarchy.
- 3D geometry, camera tracking, AR spatial anchors, and physical airflow simulation.

The reference DC ERD is a source of concepts, not a target schema. Include a concept only when it supports an agreed use case.

## 4. Context boundary and capabilities

Asset & Topology is one bounded context with three internal capabilities:

| Capability                        | Owns                                                                                                 | Primary outcomes                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Asset Registry & Lifecycle**    | Asset identity, references to seeded Asset Type and optional Asset Model, Asset status               | Register/update/retire Asset; reference bootstrap-provisioned catalog entries                    |
| **Physical Location & Placement** | Seeded Data Center reference, Site, Room/Hall, Rack, Rack layout, Rack Units, Asset Location history | Maintain topology/map beneath the default Data Center; place, move, and unmap Asset              |
| **Physical Identification**       | QR marker mapping for Rack and Node; printable label request                                         | Generate/assign/replace/deactivate QR; resolve QR to Rack or Node; prepare single or bulk labels |

These are capability boundaries inside the module, not separate NestJS modules or deployable services.

### 4.1 External ownership

| External context         | Owns                                   | Asset & Topology interaction                                                                                |
| ------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Agent Management         | Agent identity and Agent–Node binding  | References Asset ID; exposes binding commands and confirmed binding status through its public contract      |
| Monitoring/Observability | Telemetry and observed health          | References Asset ID and confirmed topology                                                                  |
| Maintenance              | Maintenance Activity state and records | Requests Asset state changes through an agreed public contract; Activity lifecycle rules are in section 5.5 |
| Ticket Management        | Ticket assignment                      | Provides the current-assignee check required for manual maintenance-state authorization                     |
| Incident, Inspection     | Their respective business records      | Store typed references to Asset/Rack IDs                                                                    |
| AR Client                | Camera tracking and spatial anchors    | Scans a Rack or Node QR to resolve its canonical ID; consumes topology/placement data                       |

No cross-module deep imports or direct reads/writes of another module's collections are allowed. Flow-level application coordination owns operations that require both Asset & Topology and Agent Management public contracts; neither module calls the other directly. Each module remains authoritative for its own data and rules.

## 5. Domain concepts and logical data

| Concept            | Meaning                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Data Center**    | Seeded default facility root for Sites; retrievable and read-only through Flow 1                               |
| **Site**           | Managed site/building-level location within a Data Center                                                      |
| **Room/Hall**      | Rectangular floor-plan area in the current 2D map scope                                                        |
| **Rack**           | Physical cabinet within a Room, occupying one logical Room-map cell in AT-02, with U capacity, QR marker, and lifecycle |
| **Rack Unit**      | One numbered U position within a Rack                                                                          |
| **Asset**          | Managed physical equipment instance with a stable AR-IMMS identity; currently supported kind is a compute Node |
| **Asset Type**     | Classification such as Node; allows an Asset to be typed before its exact Model is known                       |
| **Asset Model**    | Catalog definition with standard specifications                                                                |
| **Asset Location** | Time-bounded placement of one Asset into exactly one Rack Unit in v1                                           |
| **Rack Location**  | Time-bounded placement of a Rack in a Room, including its grid cell coordinates and orientation               |
| **QR Mapping**     | Active or historical mapping from a QR value to one Rack or Asset                                              |

### 5.1 Identity and classification

- Asset ID is the canonical stable identity.
- Asset Name is a human-readable name shown in the dashboard and Node label; it is not the canonical key.
- Serial Number is an optional manufacturer identifier; it is not the canonical key and is not assumed globally unique.
- Asset Tag is not included in v1 unless a concrete inventory/lookup use case is confirmed; it is distinct from Asset ID, Asset Name, and serial number.
- Every Asset has an Asset Type. Its Model may be unknown.
- Asset Type is immutable after registration. Descriptive updates may change the Asset Name, optional Model, and optional serial number while preserving canonical identity and Type.
- If an Asset has a Model, the Model must exist in the read-only catalog and its Type must equal the Asset's Type. The same validation applies when a Model is added or changed.
- Node Type is provisioned through seed/bootstrap; Flow 1 does not provide Type catalog CRUD. An optional Model may be referenced only when it already exists and its Type matches the Asset Type. Flow 1 does not provide Model catalog CRUD.
- The Flow 1 Asset list uses opaque `cursor` and `page_size` query parameters only, defaults to 20 entries, and caps a page at 100. AT-03 provides no list filters.
- Asset placement is tracked through Asset Location. Asset placement is 1U in v1; multi-U and multi-Rack placement are deferred until a concrete physical-device use case requires them.
- The current Flow 1 asset class is physical compute Node. Workload/Service and virtual workload inventory are not Asset types in this scope.

### 5.2 Physical topology and Room map

- Parent chain: Data Center → Site → Room/Hall → Rack.
- No Row or Aisle entity is required for the current use case. Rack can carry row_label and position_in_row as readable location labels.
- Room map v1 assumes a rectangular boundary with width_mm and depth_mm.
- A grid is generated from Room dimensions and grid_snap_mm; individual grid cells are not persisted. Only full cells exist: columns = floor(width_mm / grid_snap_mm) and rows = floor(depth_mm / grid_snap_mm). Remainder strips do not create partial cells.
- Rack coordinates are integer column and row indices from the Room's lower-left origin. Columns increase right and rows increase up.
- Each Rack occupies exactly one logical grid cell in AT-02; physical width/depth are not modeled. Rotation is limited to 0, 90, 180, or 270 degrees and is retained as location metadata; it does not change one-cell occupancy.
- Core validates that the selected cell exists and is unoccupied.
- Reject any grid_snap_mm change while the Room has an active Rack location. A width/depth change is allowed only if every active Rack cell remains inside the new full-cell grid; otherwise reject it without changing the Room or Rack layout.
- Rack location history is retained and queryable when a Rack moves between Rooms; a request with the same Room, cell coordinates, and rotation is a no-op and creates neither history nor an Audit Fact.
- Rack u_capacity, row_label, and position_in_row may be updated in AT-02. Rack identity is immutable. Room/cell/rotation are changed only through the move operation. Physical dimensions and QR mappings are not AT-02 update fields; QR management is covered by AT-07.
- Rack location history is retained when a Rack moves between Rooms; the existing Audit mechanism records actor/source/time attribution, while topology history provides prior and current location values.
- Aisle clearance, doors, columns, irregular Room polygons, and hot/cold aisle semantics are deferred.

### 5.3 Rack capacity and Asset placement

- A Rack has declared u_capacity and one Rack Unit record per U position, numbered from the bottom.
- An Asset may be unassigned or have one active placement.
- One Asset Location references exactly one Rack Unit in v1; each managed Asset occupies 1U.
- An occupied U cannot belong to another active Asset Location.
- Moving or unmapping closes the current Asset Location and preserves its history. Unmapping does not delete or retire the Asset.
- Rack Unit free/occupied state is derived from active Asset Location links. Do not persist a duplicate status unless an approved reservation use case requires it.
- Rack Unit is a storage-level concept; the domain may represent its position as a value object rather than an independently behaving aggregate.

### 5.4 QR identification

- QR can identify either a Rack or a Node/Asset. It is a lookup marker, not the canonical Rack/Asset ID, Agent ID, or AR spatial anchor.
- A Rack or Asset has at most one active QR mapping; an active QR value maps to at most one target across both target types.
- Flow 1 calls for automatic QR generation for a Node after its creation; Rack QR can be assigned or changed by an authorized Admin.
- QR changes do not change Rack or Asset identity. Marker history and attribution are retained; lookup of inactive historical QR values is not part of current resolution unless separately confirmed.
- Label generation produces printable PDF and SVG output; physical printing/application is outside Core's business transaction. Node label content includes QR, Node name, and placement. IP is omitted until an authoritative source and data freshness are defined.

### 5.5 Status and lifecycle

- Asset lifecycle states are `ACTIVE`, `MAINTENANCE`, and terminal `RETIRED`. A new Asset starts `ACTIVE` and unassigned. `ACTIVE` describes lifecycle only; it does not imply placement, Agent binding, availability, or healthy operation. Placement is represented by Asset Location, and Agent binding is owned by Agent Management.
- Unmapping an Asset does not change its lifecycle state. Supported transitions are `ACTIVE → MAINTENANCE`, `MAINTENANCE → ACTIVE`, and `ACTIVE → RETIRED`. Retirement requires maintenance to have ended, the Asset to be unmapped, and Agent Management to confirm its binding has been removed. `RETIRED` cannot be reversed, and the historical record and references are preserved.
- A Maintenance Activity entering `EXECUTE` changes the linked Asset to `MAINTENANCE`. `RESUME` or `ABORT` changes it to `ACTIVE` only when no other Activity is executing for that Asset. A Ticket `OPEN` or `CLOSED` transition alone does not change Asset state.
- IT Admin is the default actor for manual maintenance-state changes. The current assignee may change state only for an Asset linked to their currently assigned Ticket. Authorization is checked at action time. Manual action cannot return an Asset to `ACTIVE` while any Activity is executing for it.
- Rack lifecycle values are `ACTIVE` and terminal `RETIRED`; a Rack can be retired only when no Assets remain placed in it.

### 5.6 Candidate aggregate boundaries

| Aggregate root  | Owns                                                                              | Rules protected locally or coordinated by its use case                                                  |
| --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Data Center** | Seeded/bootstrap-provisioned facility root, read-only through Flow 1              | Default record is available; Flow 1 does not create or update it; child Sites reference it              |
| **Site**        | Site identity and Data Center reference                                           | Valid parent reference; no separate Building entity                                                     |
| **Room/Hall**   | Room identity, dimensions, and grid configuration                                 | Positive dimensions and valid grid; reject size/grid changes that invalidate any current Rack placement |
| **Rack**        | Rack identity, U capacity, current one-cell Room placement, and lifecycle          | U positions fit capacity; retirement requires no placed Assets                                          |
| **Asset**       | Stable Asset identity, name, type/model references, status, and placement history | Type/Model compatibility; at most one active placement; status transition rules                         |
| **QR Mapping**  | QR value, target type/ID, active/history interval                                 | Active QR is unique across Rack and Asset targets; one active QR per target                             |

Treat these as logical boundaries, not a requirement for one collection per aggregate. A placement use case coordinates the Asset and target Rack Unit so two concurrent requests cannot claim the same U. A Room layout use case coordinates the Room and Rack locations to reject invalid or occupied grid cells. Do not combine all Racks into the Room aggregate solely to enforce map geometry.

## 6. Functional requirements

| ID           | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AT-FR-01** | Seed/bootstrap provisions the default Data Center. An authorized IT Admin can view it and create/update Site and Room/Hall records beneath it with valid parent references; Flow 1 cannot create or update Data Centers.                                                                                                                                                                                                                               |
| **AT-FR-02** | A Room records physical width, depth, and grid snap. The map grid contains only complete cells: columns = `floor(width_mm / grid_snap_mm)` and rows = `floor(depth_mm / grid_snap_mm)`; remainder strips do not form cells. Grid cells are not stored individually. Reject grid-snap changes while any Rack is placed in the Room; reject width/depth changes if any Rack cell would fall outside the new grid. |
| **AT-FR-03** | An authorized IT Admin can create a Rack under an existing Room with its initial one-cell placement, U capacity, and optional row/position labels; update U capacity and row/position labels; and move/rotate it through its location operation. Rack QR is managed by AT-07.                                                                                                                                                                      |
| **AT-FR-04** | A Rack occupies one logical grid cell. Placement is rejected if its integer cell is outside the generated full-cell grid, is occupied, or has an invalid cardinal rotation.                                                                                                                                                                                                                                                                             |
| **AT-FR-05** | An Asset can be created with a required human-readable name, stable identity, and the seeded Node Asset Type even when its optional, already-existing Model or manufacturer serial number is not known. Flow 1 does not manage Type or Model catalogs.                                                                                                                                                                                                 |
| **AT-FR-06** | A new Asset starts `ACTIVE` and unassigned; it may be placed in exactly one available Rack Unit (1U) in v1.                                                                                                                                                                                                                                                                                                                                            |
| **AT-FR-07** | Assign, move, and unmap are explicit operations recorded through Asset Location. Move/unmap retain the prior placement record and do not silently retire the Asset or alter Agent binding, which Agent Management owns.                                                                                                                                                                                                                                |
| **AT-FR-08** | The system generates a QR for a newly created Node and supports assigning, replacing, deactivating, and resolving QR identifiers for both Rack and Node, subject to unambiguous active mapping.                                                                                                                                                                                                                                                        |
| **AT-FR-09** | The system can prepare individual or bulk Rack and Node labels in both PDF and SVG formats. Node labels omit IP until an authoritative source and freshness are defined.                                                                                                                                                                                                                                                                               |
| **AT-FR-10** | An Asset or Rack cannot be retired when its retirement preconditions fail. Asset retirement conditions and terminal state are defined in section 5.5.                                                                                                                                                                                                                                                                                                  |
| **AT-FR-11** | Authorized modules use the Asset & Topology application contract to reference canonical Asset/Rack IDs, query confirmed topology/placement, and request use-case-validated Asset maintenance-state changes. The Asset query returns canonical ID, name, Type ID, lifecycle state, and `currentPlacement: null` when unplaced; its provider is available independently of later Rack and Room-map queries. Contract types expose no domain or persistence types. Placement is not inferred from lifecycle state. Dashboard HTTP/OpenAPI contracts are defined by the corresponding feature tickets. |
| **AT-FR-12** | Material changes to topology, Rack layout/location, Asset state, placement, and Rack/Node QR mapping record actor, source, and timestamp through the existing Audit mechanism.                                                                                                                                                                                                                                                                         |

## 7. Business rules

1. IT Admin manages Sites, Rooms, Racks, Asset records, placement, QR mappings, and retirement. The default Data Center and Node Asset Type are provisioned through seed/bootstrap and are read-only/reference data in Flow 1. Manual maintenance-state changes follow section 5.5.
2. A child location cannot be created under a missing parent.
3. Asset ID remains stable when hostname, IP, location, QR, or Agent binding changes.
4. One Asset has at most one active location.
5. One Rack Unit has at most one active occupant.
6. A move is atomic from the user's perspective: if destination validation fails, the original location remains active.
7. Unmap releases Rack Units but retains the Asset and history.
8. Rack retirement is blocked while it contains placed Assets.
9. Asset retirement and its final state follow section 5.5; Agent Management owns binding and no module may query its persistence directly.
10. Health, availability, Agent connectivity, and workload/service state are not Asset state. Maintenance-state coordination follows section 5.5; Monitoring owns alert suppression behavior based on Asset state.
11. Other modules cannot mutate Asset & Topology data through persistence access.
12. Historical placement and marker changes do not overwrite prior topology records. Asset & Topology retains the old/new location or marker values needed to query history. Material-change attribution follows section 10 and uses no separate Audit store.

## 8. Main use cases

### 8.1 Create topology and prepare the map

1. Seed/bootstrap provisions the default Data Center; IT Admin retrieves it.
2. IT Admin creates a Site within the default Data Center.
3. IT Admin creates a Room/Hall under the Site with physical dimensions and grid snap.
4. Core validates positive dimensions and accepted snap configuration.
5. UI renders the rectangular Room and generated grid.

### 8.2 Add and position a Rack

1. IT Admin creates a Rack in an existing Room with its initial cell, rotation, U capacity, and optional row/position labels in one operation.
2. UI previews one logical cell at the selected grid coordinate; the backend independently validates the Room, cell bounds, rotation, and occupancy.
3. On success, Core atomically saves the Rack and its initial location. On failure, neither is created.
4. IT Admin may update U capacity and row/position labels independently from the location.
5. IT Admin may move or rotate the Rack. A request identical to its current Room, cell, and rotation is a no-op; a real move atomically closes the prior location and saves the new location. Invalid moves preserve the current location and history.

### 8.3 Register and place an Asset

1. IT Admin registers an Asset using the seeded Node Asset Type; an already-existing Model may be supplied or omitted.
2. Core assigns/accepts a stable Asset ID and stores the Asset as unassigned.
3. Admin selects an eligible Rack and one target U position.
4. Core validates Rack eligibility, capacity, and U availability.
5. On success, Core records an active Asset Location.
6. Move and unmap close the active location and retain history.

### 8.4 Retire an Asset or Rack

1. IT Admin requests retirement of an Asset or Rack.
2. Core checks lifecycle transition rules and local placement constraints.
3. Asset retirement is allowed only from `ACTIVE`, after maintenance has ended, the Asset is unmapped, and Agent Management confirms its binding has been removed through an agreed public-contract approach. A Rack can be retired only when no Assets are placed in it.
4. If any precondition fails or Agent binding eligibility cannot be verified, retirement is rejected with the unmet condition.
5. If valid, the lifecycle changes to terminal `RETIRED` and history is retained.

### 8.5 Manage Rack and Node QR

1. Core generates a QR mapping when a Node is created; an IT Admin can assign or change a Rack QR.
2. Core validates that the active QR resolves to only one Rack or Node.
3. The mapping change is recorded through the existing Audit mechanism with actor, source, and timestamp; the mapping points to the canonical target ID.
4. A lookup resolves an active QR to the canonical Rack or Asset ID.
5. Label generation returns the requested single/bulk PDF or SVG output. Node labels include name and current placement; IP is omitted until its authoritative source and freshness are defined.

## 9. Module architecture

Implement one NestJS module under src/modules/asset-topology/, following Modular Monolith + Clean Architecture + capability-based vertical slicing.

    src/modules/asset-topology/
    ├── contracts/                 # Only once another module needs a public contract
    ├── domain/                    # Pure TypeScript models, value objects, policies, errors
    ├── application/
    │   ├── asset-registry/
    │   ├── physical-location/
    │   └── physical-identification/
    ├── infrastructure/
    │   └── mongodb/
    ├── presentation/
    │   ├── assets/
    │   ├── topology/
    │   └── physical-identification/
    ├── asset-topology.module.ts
    ├── index.ts                   # Explicit public exports only
    └── README.md

This is a navigation proposal, not mandatory scaffolding. Add a folder only when it improves locality. Co-locate tests with code. Do not create empty contracts, ports, handlers, or generic base repositories.

Cross-domain use cases that require both Asset & Topology and Agent Management contracts are coordinated at the Infrastructure Asset Management Flow application boundary. The coordinator does not own domain data or rules. Binding eligibility requires an `ACTIVE` Node with a current Asset Location; retirement requires a confirmed unbound result from Agent Management and fails closed when binding status is unavailable. This defines interaction ownership without selecting a concurrency mechanism: AT-10 must define and verify protection against concurrent bind/retire operations.

### 9.1 Layer responsibilities

- **Domain:** identity, lifecycle transitions, placement/map value objects, business policies, and domain errors. No NestJS, Mongoose, HTTP, or external SDK dependency.
- **Application:** one use case per primary business outcome; loads required state, invokes policies, coordinates persistence and public module ports.
- **Infrastructure:** MongoDB schemas/stores/mappers and concrete external adapters. It does not decide lifecycle or placement rules.
- **Presentation:** REST input/output validation and controller dispatch. It does not directly mutate persistence or implement business workflows.
- **Contracts:** only stable cross-module queries/commands/events with actual consumers. No internal domain or Mongoose types are exported.

Potential domain roots and persistence mapping must be reviewed before implementation; ERD rows do not automatically map one-to-one to aggregate roots or Mongo collections.

## 10. Cross-module and audit behavior

- Asset & Topology is authoritative for its own IDs, topology, Rack/Node QR mappings, Asset lifecycle, and Asset Location records.
- Agent Management is authoritative for Agent identity and Agent–Node binding. Its public contract supports binding commands and confirmed binding-status queries. The Flow-level application coordinator reads Asset lifecycle and current placement through the Asset & Topology contract before requesting binding; only `ACTIVE`, placed Nodes are eligible. For retirement, the coordinator confirms the Node is unbound through Agent Management before requesting retirement through Asset & Topology, and fails closed if that check is unavailable or unknown. Neither module accesses the other's persistence or directly calls the other.
- Monitoring/Observability owns telemetry and observed health; Asset & Topology supplies stable IDs and confirmed topology.
- Maintenance owns its Activities and requests Asset state changes through an agreed public contract; Ticket Management owns assignment and provides the current-assignee check for manual maintenance authorization.
- Incident, Inspection, and AR clients reference IDs and use public queries/contracts as required.
- Reuse the existing Audit/platform mechanism for actor/source/time/material-change traceability. Do not add a separate audit repository or store.
- The public Asset & Topology application contract exposes canonical IDs and confirmed topology/placement needed by authorized consumers, plus a validated command for requesting Asset maintenance-state changes. It does not expose domain internals or persistence models.
- The initial Asset query returns `id`, `name`, `assetTypeId`, `lifecycleState`, and `currentPlacement` (`null` or `{ rackId, uPosition }`). The Dashboard uses these fields for Asset inventory/detail and place/move/unmap workflows (Flow 1 use cases 9.1–9.3); `currentPlacement` is the sole placement indicator.
- The Rack and Room-map queries are exposed through a dedicated read-only Rack/Room-map port. Rack reads return canonical ID, U capacity, row/position labels, and current location (`{ roomId, column, row, rotation }`); Rack location history is queryable as ordered, time-bounded intervals. Room-map reads return `id`, `widthMm`, `depthMm`, `gridSnapMm`, complete-cell counts, and confirmed active Rack placements. The existing Asset query provider remains independently available; the broader consumer port remains unbound until its remaining queries are implemented. These results do not include model/serial metadata, QR mappings, Agent binding, or health.
- Maintenance requests a target Asset state through `requestMaintenanceStateChange`; the Asset & Topology use case validates Asset-owned lifecycle rules. Maintenance remains authoritative for Activity state and must confirm no other Activity remains in `EXECUTE` before requesting `ACTIVE`; if that confirmation is unavailable, the transition is not successful. AT-05 must define retry/idempotency and consistency behavior when the Asset state command cannot be completed during an Activity transition.
- Ticket Management remains authoritative for assignment and exposes a current-assignee check evaluated at action time. If the check is unavailable, a non-Admin manual maintenance-state change is rejected.
- AT-13 interaction and failure requirements are tracked in [issue #37](https://github.com/AR-IMMS/core-backend/issues/37); the consuming Asset & Topology implementation tickets are [AT-05 / issue #42](https://github.com/AR-IMMS/core-backend/issues/42) and [AT-10 / issue #47](https://github.com/AR-IMMS/core-backend/issues/47). The repository and approved ticket material contain no separate owning-domain contract issues or accountable owners for Maintenance, Ticket Management, or Agent Management. Keep those missing agreements tracked in AT-13 until the owning teams and owners are identified; then link or create their issues.
- Publish integration events only for a real downstream consumer. Do not introduce a generic event bus or event catalog solely for this module.

## 11. Validation, failure, and concurrency

Expected failures include missing parent location, duplicate active QR, unknown Asset Type/Model, Type–Model mismatch, missing Asset Name, invalid Room dimensions, unsupported snap/rotation, Rack out of bounds, Rack overlap, insufficient Rack capacity, occupied U, invalid status transition, non-empty Rack retirement, and linked-Agent retirement.

Application use cases must preserve prior valid state when a move or update fails. Concurrent placement requests must not allocate the same active Rack Unit. Enforce this with an atomic persistence strategy/constraint appropriate to the selected MongoDB model, not only a UI pre-check.

## 12. Security and audit requirements

- Enforce role-based authorization at the API/application boundary: IT Admins manage Flow 1 records, while manual maintenance-state changes are also allowed to the current assignee of a Ticket linked to the Asset, subject to the rules in section 5.5.
- Validate IDs, dimensions, coordinate ranges, snap values, lifecycle inputs, QR values, and model specifications at the boundary and enforce business invariants in domain/application logic.
- Record actor, source, and timestamp for material changes via the existing Audit approach; do not create a separate Audit store.
- Do not log credentials or sensitive Agent information in this module.
- Limit label output to Rack/Node identity and location information required for field use. Omit IP until its authoritative source and freshness are defined.

## 13. Acceptance criteria

The module is ready for its first integration when:

- The seeded default Data Center can be retrieved, and its Site → Room → Rack hierarchy can be created and queried without Flow 1 Data Center create/update operations.
- Room grids contain only complete cells and are generated without persisting individual floor cells. Grid-snap changes are rejected while any Rack is placed; width/depth changes are rejected if a Rack would fall outside the resulting grid.
- A Rack can be created atomically with its initial one-cell location and moved on the Room map; invalid bounds, occupied cells, and rotation are rejected by Core. Repeating the current location is a no-op without history or an Audit Fact.
- An Asset can be registered without a Model, and Type–Model mismatch is rejected when a Model is supplied.
- An Asset can remain unassigned, be placed in one available U, be moved, and be unmapped with location history retained.
- Two concurrent operations cannot commit the same U to different active placements.
- Rack and Node QR generation/assignment, uniqueness, lookup, and label generation work in both PDF and SVG.
- Rack/Asset retirement preconditions are enforced: an Asset must be ACTIVE, maintenance ended, unmapped, and Agent-unlinked; Rack has no placed Assets. `RETIRED` is terminal. Checks use public contracts, not direct cross-module database reads.
- Other modules can consume canonical Asset/Rack IDs and confirmed topology/placement through public contracts without importing internal implementation classes.
- Material changes are attributable by actor, source, and timestamp through the existing Audit mechanism; no separate Audit store exists.
- Focused domain, application, persistence-adapter, and controller tests cover invariants and failure paths.

## 14. Test strategy

- **Domain tests:** identity stability, Type/Model compatibility, approved status transitions, geometry/bounds/overlap, 1U placement/capacity, QR target uniqueness.
- **Application tests:** use-case orchestration, history closure, rejected operations preserving prior state, external eligibility check via a fake public port.
- **Mongo adapter tests:** persistence mapping, active-location uniqueness/concurrency behavior, current/historical placement queries, active QR uniqueness across Rack and Node.
- **API tests:** input validation, authorization, error mapping, and contract response shape.
- Test meaningful business risks; do not mirror every field or method with a trivial test.

## 15. Confirmed v1 constraints and deferred decisions

1. **Room geometry:** v1 supports rectangular Rooms only; irregular boundaries and obstacles are deferred.
2. **Grid configuration:** use per-Room grid_snap_mm; visual major grid lines are UI configuration.
3. **Rack map occupancy:** AT-02 models each Rack as exactly one logical grid cell and does not model physical width/depth. Only complete Room cells exist: `floor(dimension / grid_snap_mm)`; partial remainder strips are not cells.
4. **U occupancy:** v1 places each Asset in one U; occupied/free is derived from active Asset Location; no reservation state.
5. **Asset size:** multi-U, multi-Rack, and fragmented placement are deferred.
6. **QR history:** Rack and Node have QR mappings. Active resolution must be unambiguous; historical QR lookup is not confirmed. Preserve history and attribution.
7. **Asset identity fields:** require `name`; serial number is optional. Asset Tag is deferred unless a distinct inventory lookup use case is approved.
8. **Node label IP:** omit IP from labels until the authoritative source and freshness are defined.
9. **Asset custom attributes:** broad custom attributes are outside the initial Flow 1 implementation unless separately approved.

## 16. Deferred extensions

Add only when a concrete requirement appears: multi-U/multi-Rack/fragmented Asset placement, Row/Aisle entities, hot/cold aisle semantics, Rack clearances and Room obstacles, irregular floor polygons, Asset Component inventory, procurement/ownership assignment, virtual assets, Workload/Service topology, power/cooling/network topology, 3D geometry, or AR spatial anchoring.

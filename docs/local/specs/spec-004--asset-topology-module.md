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
- Keep Asset status separate from placement, Agent connectivity, observed health, and workload/service state. The Flow 1 maintenance status is recorded on the Asset; Monitoring owns the policy for suppressing alerts during maintenance.
- The current architecture does not include an Operational Context module.

## 3. Scope

### 3.1 In scope

- Manage Data Center → Site → Room/Hall → Rack.
- Treat Site as the AR-IMMS concept corresponding to Building in the reference DC ERD; do not add a separate Building entity.
- Maintain a 2D Room map using physical dimensions, a generated grid, Rack footprints, coordinates, and rotation.
- Manage Rack capacity and individual Rack U positions.
- Register and maintain Asset, Asset Type, and Asset Model records.
- Place, move, and unmap Assets in Rack U positions while retaining location history.
- Maintain QR identity for both Rack and Node, and support individual or bulk printable labels in PDF or SVG.
- Retain attribution and timestamps for material changes through the agreed audit mechanism.
- Provide stable identifiers and confirmed topology/placement for other flows.

### 3.2 Out of scope

- Workload and Service registry, container/process inventory, and service dependency topology.
- Agent enrollment, credentials, heartbeat, configuration, binding ownership, unlink, and uninstall.
- Telemetry ingestion, health evaluation, alerting, and Incident lifecycle.
- Maintenance and Inspection workflows, checklists, findings, corrective actions, and ticket handling.
- Component-level hardware inventory such as individually tracked DIMMs, disks, NICs, and PSUs.
- Procurement, vendor lifecycle, finance, warranty management, billing, tenants, and ownership-assignment workflows unless separately approved.
- PDU, power/cooling capacity, electrical/network topology, switches, routers, storage arrays, and detailed facilities engineering.
- Region/Availability Zone/cloud hierarchy.
- 3D geometry, camera tracking, AR spatial anchors, and physical airflow simulation.

The reference DC ERD is a source of concepts, not a target schema. Include a concept only when it supports an agreed use case.

## 4. Context boundary and capabilities

Asset & Topology is one bounded context with three internal capabilities:

| Capability | Owns | Primary outcomes |
|---|---|---|
| **Asset Registry & Lifecycle** | Asset identity, Asset Type, Asset Model, Asset status | Register/update/retire Asset; maintain Type and Model catalog |
| **Physical Location & Placement** | Data Center, Site, Room/Hall, Rack, Rack layout, Rack Units, Asset Location history | Maintain topology/map; place, move, and unmap Asset |
| **Physical Identification** | QR marker mapping for Rack and Node; printable label request | Generate/assign/replace/deactivate QR; resolve QR to Rack or Node; prepare single or bulk labels |

These are capability boundaries inside the module, not separate NestJS modules or deployable services.

### 4.1 External ownership

| External context | Owns | Asset & Topology interaction |
|---|---|---|
| Agent Management | Agent identity and Agent–Node binding | References Asset ID; supplies the retirement precondition through an agreed public boundary |
| Monitoring/Observability | Telemetry and observed health | References Asset ID and confirmed topology |
| Incident, Maintenance, Inspection | Their respective business records | Store typed references to Asset/Rack IDs |
| AR Client | Camera tracking and spatial anchors | Scans a Rack or Node QR to resolve its canonical ID; consumes topology/placement data |

No cross-module deep imports or direct reads/writes of another module's collections are allowed. The exact Agent Management contract is intentionally not specified here.

## 5. Domain concepts and logical data

| Concept | Meaning |
|---|---|
| **Data Center** | Managed facility parent for one or more Sites |
| **Site** | Managed site/building-level location within a Data Center |
| **Room/Hall** | Rectangular floor-plan area in the current 2D map scope |
| **Rack** | Physical cabinet within a Room, with floor footprint, U capacity, QR marker, and lifecycle |
| **Rack Unit** | One numbered U position within a Rack |
| **Asset** | Managed physical equipment instance with a stable AR-IMMS identity; currently supported kind is a compute Node |
| **Asset Type** | Classification such as Node; allows an Asset to be typed before its exact Model is known |
| **Asset Model** | Catalog definition with standard specifications |
| **Asset Location** | Time-bounded placement of one Asset into exactly one Rack Unit in v1 |
| **Rack Location** | Time-bounded placement of a Rack in a Room, including its 2D footprint and orientation |
| **QR Mapping** | Active or historical mapping from a QR value to one Rack or Asset |

### 5.1 Identity and classification

- Asset ID is the canonical stable identity.
- Asset Name is a human-readable name shown in the dashboard and Node label; it is not the canonical key.
- Serial Number is an optional manufacturer identifier; it is not the canonical key and is not assumed globally unique.
- Asset Tag is not included in v1 unless a concrete inventory/lookup use case is confirmed; it is distinct from Asset ID, Asset Name, and serial number.
- Every Asset has an Asset Type. Its Model may be unknown.
- If an Asset has a Model, the Model's Type must equal the Asset's Type.
- Asset Model specs describe model-level specifications. Asset custom attributes, if retained, are validated instance-specific attributes and must not duplicate model specs.
- Asset placement is 1U in v1. Multi-U and multi-Rack placement are deferred until a concrete physical-device use case requires them.
- The current Flow 1 asset class is physical compute Node. Workload/Service and virtual workload inventory are not Asset types in this scope.

### 5.2 Physical topology and Room map

- Parent chain: Data Center → Site → Room/Hall → Rack.
- No Row or Aisle entity is required for the current use case. Rack can carry row_label and position_in_row as readable location labels.
- Room map v1 assumes a rectangular boundary with width_mm and depth_mm.
- A grid is generated from Room dimensions and grid_snap_mm; individual grid cells are not persisted as domain records.
- Coordinate origin is the Room's lower-left corner. X increases right; Y increases up.
- Rack position (pos_x_mm, pos_y_mm) identifies the lower-left anchor of the unrotated footprint.
- Rack footprint is width_mm × depth_mm. Rotation is limited to supported cardinal orientations; 90°/270° swap effective footprint dimensions.
- Room dimensions and Rack footprints use millimeters. UI snapping and major grid lines are presentation behavior based on Room configuration.
- Layout validation checks that the full footprint is inside the Room and does not overlap another Rack.
- Rack location history is retained when a Rack moves between Rooms; Audit records actor/time/change attribution, while topology history provides the prior and current location values.
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
- Label generation produces printable output; physical printing/application is outside Core's business transaction. Node label content includes QR, Node name, and placement; IP is shown when an authoritative value is available.

### 5.5 Status and lifecycle

- Placement is separate from status: a newly created active Asset can be unassigned, and unmapping does not change its status.
- Proposed minimal Asset status values for review are `active`, `maintenance`, and `retired`. Maintenance is explicit in Flow 1; Monitoring decides how it affects alert evaluation.
- Proposed minimal Rack lifecycle values for review are `active` and `retired`; no separate Rack maintenance state is included without a Rack maintenance use case.
- Retirement preserves the historical record and references.
- A Rack cannot be retired while Assets remain placed in it.
- A Node cannot be retired while an Agent remains linked; it must first be unlinked by Agent Management.
- These values are a proposal, not yet an approved transition catalog. In particular, allowed transitions into/out of `maintenance` and the retire operation must be confirmed before implementing those use cases.

### 5.6 Candidate aggregate boundaries

| Aggregate root | Owns | Rules protected locally or coordinated by its use case |
|---|---|---|
| **Data Center** | Facility identity and administrative fields | Valid identity; child Sites reference an existing Data Center |
| **Site** | Site identity and Data Center reference | Valid parent reference; no separate Building entity |
| **Room/Hall** | Room identity, dimensions, and grid configuration | Positive dimensions and valid grid; changing dimensions must not invalidate existing Rack footprints |
| **Rack** | Rack identity, U capacity, current physical placement, and lifecycle | U positions fit capacity; retirement requires no placed Assets |
| **Asset** | Stable Asset identity, name, type/model references, status, and placement history | Type/Model compatibility; at most one active placement; status transition rules |
| **QR Mapping** | QR value, target type/ID, active/history interval | Active QR is unique across Rack and Asset targets; one active QR per target |

Treat these as logical boundaries, not a requirement for one collection per aggregate. A placement use case coordinates the Asset and target Rack Unit so two concurrent requests cannot claim the same U. A Room layout use case coordinates the Room and Rack locations to reject out-of-bounds or overlapping Rack footprints. Do not combine all Racks into the Room aggregate solely to enforce map geometry.

## 6. Functional requirements

| ID | Requirement |
|---|---|
| **AT-FR-01** | An authorized IT Admin can create/update Data Center, Site, and Room/Hall records with valid parent references. |
| **AT-FR-02** | A Room records physical width, depth, and grid snap. The map grid is generated from these values; grid cells are not stored individually. |
| **AT-FR-03** | An authorized IT Admin can create/update Rack records under an existing Room, including footprint, map position/orientation, U capacity, readable row/position labels, and Rack QR. |
| **AT-FR-04** | Rack placement is rejected if its footprint is outside the Room, violates snap rules, has invalid rotation, or overlaps another Rack. |
| **AT-FR-05** | An Asset can be created with a required human-readable name, stable identity, and Asset Type even when its Model or manufacturer serial number is not yet known. |
| **AT-FR-06** | An Asset may be unassigned or placed in exactly one available Rack Unit (1U) in v1. |
| **AT-FR-07** | Assign, move, and unmap are explicit operations. Move/unmap retain the prior placement record and do not silently retire or unlink the Asset. |
| **AT-FR-08** | The system generates a QR for a newly created Node and supports assigning, replacing, deactivating, and resolving QR identifiers for both Rack and Node, subject to unambiguous active mapping. |
| **AT-FR-09** | The system can prepare individual or bulk Rack and Node labels in the approved PDF or SVG format. |
| **AT-FR-10** | An Asset or Rack cannot be retired when its retirement preconditions fail. |
| **AT-FR-11** | Other modules can reference canonical Asset/Rack IDs and confirmed placement through a public module boundary when needed. |
| **AT-FR-12** | Material changes to topology, Rack layout/location, Asset status, placement, and Rack/Node QR mapping are attributable and timestamped. |

## 7. Business rules

1. IT Admin manages topology, Asset records, placement, QR mappings, and retirement. Flow 1 also assigns the Technician the maintenance-status action, but its prerequisite says the actor must be an Admin; this role conflict must be resolved before authorization rules are implemented.
2. A child location cannot be created under a missing parent.
3. Asset ID remains stable when hostname, IP, location, QR, or Agent binding changes.
4. One Asset has at most one active location.
5. One Rack Unit has at most one active occupant.
6. A move is atomic from the user's perspective: if destination validation fails, the original location remains active.
7. Unmap releases Rack Units but retains the Asset and history.
8. Rack retirement is blocked while it contains placed Assets.
9. Asset retirement is blocked while Agent Management reports an active binding; this module must not query Agent persistence directly.
10. Health, availability, Agent connectivity, and workload/service state are not Asset status. Flow 1 records whether an Asset is under maintenance; Monitoring owns alert suppression behavior based on that status.
11. Other modules cannot mutate Asset & Topology data through persistence access.
12. Historical placement and marker changes do not overwrite prior topology records. Audit captures actor/time/change attribution; Asset & Topology retains the old/new location or marker values needed to query history.

## 8. Main use cases

### 8.1 Create topology and prepare the map

1. IT Admin creates a Data Center.
2. IT Admin creates a Site within that Data Center.
3. IT Admin creates a Room/Hall with physical dimensions and grid snap.
4. Core validates positive dimensions and accepted snap configuration.
5. UI renders the rectangular Room and generated grid.

### 8.2 Add and position a Rack

1. IT Admin creates or selects a Rack, providing its floor footprint and U capacity.
2. UI displays the footprint as a preview attached to the pointer.
3. Admin selects an anchor position and rotation.
4. UI provides immediate feedback; Core independently validates bounds, grid alignment, rotation, and overlap.
5. If valid, Core saves Rack layout fields. If invalid, it returns the failed constraint and leaves the existing layout unchanged.
6. Human-readable row/position labels can be maintained independently of coordinates.

### 8.3 Register and place an Asset

1. IT Admin registers an Asset with Asset Type; Model may be omitted.
2. Core assigns/accepts a stable Asset ID and stores the Asset as unassigned.
3. Admin selects an eligible Rack and one target U position.
4. Core validates Rack eligibility, capacity, and U availability.
5. On success, Core records an active Asset Location.
6. Move and unmap close the active location and retain history.

### 8.4 Retire an Asset or Rack

1. IT Admin requests retirement.
2. Core checks lifecycle transition rules and local placement constraints.
3. For Node retirement, the Agent Management eligibility check is performed through its public boundary when available.
4. If a precondition fails, retirement is rejected with the unmet condition.
5. If valid, the lifecycle changes and history is retained.

### 8.5 Manage Rack and Node QR

1. Core generates a QR mapping when a Node is created; an IT Admin can assign or change a Rack QR.
2. Core validates that the active QR resolves to only one Rack or Node.
3. The mapping change is recorded with actor and timestamp; the mapping points to the canonical target ID.
4. A lookup resolves an active QR to the canonical Rack or Asset ID.
5. Label generation returns the requested single/bulk printable output. Node labels include name and current placement; IP is included only if available from an authoritative source.

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

### 9.1 Layer responsibilities

- **Domain:** identity, lifecycle transitions, placement/map value objects, business policies, and domain errors. No NestJS, Mongoose, HTTP, or external SDK dependency.
- **Application:** one use case per primary business outcome; loads required state, invokes policies, coordinates persistence and public module ports.
- **Infrastructure:** MongoDB schemas/stores/mappers and concrete external adapters. It does not decide lifecycle or placement rules.
- **Presentation:** REST input/output validation and controller dispatch. It does not directly mutate persistence or implement business workflows.
- **Contracts:** only stable cross-module queries/commands/events with actual consumers. No internal domain or Mongoose types are exported.

Potential domain roots and persistence mapping must be reviewed before implementation; ERD rows do not automatically map one-to-one to aggregate roots or Mongo collections.

## 10. Cross-module and audit behavior

- Asset & Topology is authoritative for its own IDs, topology, Rack/Node QR mappings, placement, and status/lifecycle.
- Agent Management is authoritative for Agent identity and binding. The retirement precondition is an integration point; contract shape and dependency direction are deferred to the Agent Management design.
- Monitoring/Observability owns telemetry and observed health; Asset & Topology supplies stable IDs and confirmed topology.
- Incident, Maintenance, Inspection, and AR clients reference IDs and use public queries/contracts as required.
- Reuse the existing Audit/platform mechanism for actor/time/material-change traceability. Do not add a separate audit repository without a demonstrated requirement.
- Publish integration events only for a real downstream consumer. Do not introduce a generic event bus or event catalog solely for this module.

## 11. Validation, failure, and concurrency

Expected failures include missing parent location, duplicate active QR, unknown Asset Type/Model, Type–Model mismatch, missing Asset Name, invalid Room dimensions, unsupported snap/rotation, Rack out of bounds, Rack overlap, insufficient Rack capacity, occupied U, invalid status transition, non-empty Rack retirement, and linked-Agent retirement.

Application use cases must preserve prior valid state when a move or update fails. Concurrent placement requests must not allocate the same active Rack Unit. Enforce this with an atomic persistence strategy/constraint appropriate to the selected MongoDB model, not only a UI pre-check.

## 12. Security and audit requirements

- Enforce role-based authorization at the API/application boundary after resolving the Flow 1 Admin-versus-Technician permission conflict.
- Validate IDs, dimensions, coordinate ranges, snap values, lifecycle inputs, QR values, and model specifications at the boundary and enforce business invariants in domain/application logic.
- Record actor and timestamp for material changes via the existing audit approach.
- Do not log credentials or sensitive Agent information in this module.
- Limit label output to Rack/Node identity and location information required for field use; include IP only when its source and freshness are defined.

## 13. Acceptance criteria

The module is ready for its first integration when:

- A valid Data Center → Site → Room → Rack hierarchy can be created and queried.
- The Room grid is generated from dimensions/snap without persisting individual floor cells.
- A Rack can be placed and moved on the Room map; invalid bounds, overlap, snap, and rotation are rejected by Core.
- An Asset can be registered without a Model, and Type–Model mismatch is rejected when a Model is supplied.
- An Asset can remain unassigned, be placed in one available U, be moved, and be unmapped with location history retained.
- Two concurrent operations cannot commit the same U to different active placements.
- Rack and Node QR generation/assignment, uniqueness, lookup, and label generation work for the approved format.
- Rack/Asset retirement preconditions are enforced without direct cross-module database reads.
- Other modules can consume public Asset/Rack IDs without importing internal implementation classes.
- Focused domain, application, persistence-adapter, and controller tests cover invariants and failure paths.

## 14. Test strategy

- **Domain tests:** identity stability, Type/Model compatibility, approved status transitions, geometry/bounds/overlap, 1U placement/capacity, QR target uniqueness.
- **Application tests:** use-case orchestration, history closure, rejected operations preserving prior state, external eligibility check via a fake public port.
- **Mongo adapter tests:** persistence mapping, active-location uniqueness/concurrency behavior, current/historical placement queries, active QR uniqueness across Rack and Node.
- **API tests:** input validation, authorization, error mapping, and contract response shape.
- Test meaningful business risks; do not mirror every field or method with a trivial test.

## 15. Decisions to confirm during review

1. **Room geometry:** v1 supports rectangular Rooms only; irregular boundaries and obstacles are deferred.
2. **Grid configuration:** proposed per-Room grid_snap_mm; visual major grid lines are UI configuration.
3. **Rack dimensions:** proposed to store width/depth in millimeters on Rack until a Rack Model catalog is justified.
4. **U occupancy:** v1 places each Asset in one U; occupied/free is derived from active Asset Location; no reservation state.
5. **Asset size:** multi-U, multi-Rack, and fragmented placement are deferred.
6. **Status vocabulary:** proposed Asset values are `active`, `maintenance`, `retired`; proposed Rack values are `active`, `retired`. Confirm transitions, especially maintenance exit and retirement, before implementation.
7. **QR history:** Rack and Node have QR mappings. Active resolution must be unambiguous; historical QR lookup is not confirmed. Preserve history and attribution.
8. **Asset identity fields:** require `name`; serial number is optional. Asset Tag is deferred unless a distinct inventory lookup use case is confirmed.
9. **Node label IP:** Flow 1 requests IP on the label, but the authoritative owner/source and freshness of that IP need confirmation. Do not make it an Asset field by assumption.
10. **Data Center status and owner organization:** define whether these are lifecycle/administrative data and which external identity owns owner_org_id.
11. **Asset custom attributes:** define validation by Asset Type and prohibit duplication of Model specs before exposing broad write APIs.
12. **Audit mechanism:** use the existing platform Audit mechanism; confirm required event fields/retention in implementation review rather than adding module-specific audit tables. Asset & Topology still retains queryable location history.
13. **Agent retirement guard:** keep Flow 1 behavior; defer contract shape and dependency direction to Agent Management integration design.
14. **Maintenance-status permission:** Flow 1 says both that the actor must be Admin and that a Technician changes an Asset to maintenance. Resolve which role is authorized before implementing the permission policy.

## 16. Deferred extensions

Add only when a concrete requirement appears: multi-U/multi-Rack/fragmented Asset placement, Row/Aisle entities, hot/cold aisle semantics, Rack clearances and Room obstacles, irregular floor polygons, Asset Component inventory, procurement/ownership assignment, virtual assets, Workload/Service topology, power/cooling/network topology, 3D geometry, or AR spatial anchoring.


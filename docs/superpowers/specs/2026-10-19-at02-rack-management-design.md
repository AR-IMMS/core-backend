# AT-02 Rack Management and Room-map Design

## Goal

Implement backend Rack management and Room-map interaction support in Asset & Topology. Admins can create a Rack in a Room, move or rotate it, inspect the Room map, and maintain Rack row/position labels independently from map coordinates. The backend remains authoritative for placement validation and audit attribution.

## Scope and decisions

- This ticket covers the backend in `core-backend`. Dashboard rendering and placement preview remain in the frontend repository.
- A Rack occupies exactly one logical Room-map cell. AT-02 does not model Rack physical width or depth.
- Rack map coordinates are integer `column` and `row` indices. The Room grid origin and orientation continue to follow the Room-map convention: lower-left origin, columns increasing right, rows increasing up. Grid dimensions are `floor(widthMm / gridSnapMm)` columns by `floor(depthMm / gridSnapMm)` rows; partial remainder strips do not form cells.
- Rack orientation is stored as a cardinal rotation (`0`, `90`, `180`, or `270` degrees). Because a Rack occupies one cell, rotation does not change the occupied cell or bounds calculation.
- Rack creation and its initial location are one atomic operation. A successfully created Rack always belongs to an existing Room and has an active location.
- Rack location history stores Room, column, row, rotation, and effective timestamps. Moving a Rack closes the previous active location and creates the new location atomically; invalid moves preserve the previous location.
- Authorized callers can query the complete Rack location history, ordered by effective start time, including the active interval.
- Rack row and position labels are Rack metadata and remain independent of map coordinates.
- AT-02 permits Rack updates to `uCapacity`, `rowLabel`, and `positionInRow`. Rack ID is immutable. Room, `column`, `row`, and rotation change only through the location operation. Physical dimensions and QR mappings are not Rack update fields in AT-02; QR remains in AT-07.
- The Room-map query returns Room grid metadata and the active Rack placements for that Room. Rack detail returns the canonical Rack identity, capacity, labels, and current location.
- Expose Rack and Room-map reads through a dedicated read-only Asset & Topology query port when implemented. Keep the existing Asset query port available independently. Leave the broader consumer contract unbound until its remaining queries are implemented.
- Reuse the existing Audit/Outbox mechanism for material Rack and location changes, recording actor, source, and time. Do not add an Audit store.
- A Room `gridSnapMm` change is rejected while any Rack has an active location in that Room. A Room width/depth change is rejected if the resulting full-cell grid would put any active Rack cell outside the grid.
- QR editing remains in AT-07. Asset placement, U occupancy, maintenance, retirement, and actual Dashboard UI remain outside AT-02.

## Backend behavior

### Create Rack

The create operation accepts the Room, one-cell `column`/`row`, cardinal rotation, U capacity, and optional row/position labels. It verifies that the Room exists, the coordinates are integer grid indices within `0 <= column < floor(widthMm / gridSnapMm)` and `0 <= row < floor(depthMm / gridSnapMm)`, and the cell is unoccupied. It creates the Rack and its first active Rack location within one unit of work. Any validation or persistence failure leaves neither record partially created.

### Move or rotate Rack

The location operation accepts a destination Room, integer `column`/`row`, and cardinal rotation. It validates the destination Room and occupied cell against the current active Rack locations. The current Rack location is excluded from overlap checks. If Room, `column`, `row`, and rotation equal the current location, the operation is a no-op: it creates no history record and emits no Audit Fact. A real move or rotation closes the prior location and records the new location in the same unit of work. Invalid requests do not change either the active location or its history.

### Room map and Room changes

The Room-map read returns the Room ID and grid definition together with all Racks currently located in that Room. Each Rack entry includes its canonical Rack ID, U capacity, independent row/position labels, and current location. The generated grid is derived from Room dimensions and snap size; cell occupancy is derived from active Rack locations and is not stored as a grid document.

Only complete grid cells exist: grid columns are `floor(widthMm / gridSnapMm)` and rows are `floor(depthMm / gridSnapMm)`; leftover width/depth does not create a partial cell. Reject any `gridSnapMm` change while the Room has an active Rack location. Permit a width/depth change only when every active Rack cell remains inside the resulting full-cell grid. Preserve the existing Room state and Audit sequence on rejection.

### Audit and authorization

Rack create, Rack metadata changes, and location changes use the existing audit event path and include actor, source, and time according to current repository conventions. Rack management routes use the existing `asset:read` and `asset:manage` permission model; manual actor attribution follows the established IT Admin path.

## Contract impact

Replace the current physical placement width/depth representation in the Rack query contract with one-cell grid coordinates (`column`, `row`) and rotation. Add a dedicated read-only query-port token/provider for Rack and Room-map reads. The existing Asset query port/provider continues independently and remains available. The broader consumer port remains unbound until its full method set is available.

The REST/OpenAPI contract exposes Room-map retrieval, Rack creation with initial location, Rack detail/update, Rack location changes, and a read-only Rack location-history query. The contract must not expose physical Rack width or depth in AT-02.

## Failure and consistency requirements

- Reject non-integer, negative, or out-of-grid cell indices.
- Reject unsupported rotations.
- Treat unchanged Room, `column`, `row`, and rotation on a move request as a no-op with no history or Audit Fact.
- Reject an occupied destination cell, including concurrent attempts where persistence constraints or transaction validation detect the conflict.
- Reject moves to nonexistent Rooms.
- Keep create and move operations atomic with their location history and audit/outbox facts.
- Reject `gridSnapMm` changes while a Room has any active Rack location; reject width/depth changes that place an active Rack outside the new full-cell grid.
- Keep row/position labels independent of map coordinates.

## Verification approach

- Domain tests cover cell bounds, overlap, rotation validation, and Room grid changes against active Rack locations.
- Application tests cover atomic create/move behavior, failed-operation invariance, location history, audit attribution, and query results.
- Infrastructure tests cover Mongo persistence, active-location uniqueness, and transaction behavior using the repository's configured Mongo test environment.
- Controller/OpenAPI checks cover the request/response contract and authorization mapping.
- Tests are colocated under each implementation folder's `__tests__/` directory.

## Superseded decision

The prior design discussion selected Rack-level `widthMm` and `depthMm`. The approved AT-02 adjustment supersedes that choice: this ticket uses one logical grid cell and does not model physical Rack dimensions. The AT-02 spec and consumer contracts now follow this rule.

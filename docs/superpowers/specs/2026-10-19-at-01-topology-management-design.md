# AT-01 Topology Management Design

**Status:** Approved for planning
**Scope:** AT-01, issue #38
**Sources:** `docs/local/specs/spec-004--asset-topology-module.md`, `docs/shared/business/01-infrastructure-asset-management.md`, `.scratch/ticket-drafts/asset-topology/tickets.md`

## Goal

Implement the first persistent and public Asset & Topology slice for the location hierarchy. Provision one stable default Data Center, allow IT Admins to retrieve it, and allow them to create, read, and update Sites and Rooms beneath it. Flow 1 exposes no Data Center create or update operation.

## Current repository state

- The Asset & Topology module currently has domain code for Assets, Racks, Room maps, and placement policies, plus the AT-12 consumer contract. It has no topology application use cases, MongoDB adapters, HTTP controllers, or module composition.
- IAM already defines `asset:read` and `asset:manage`, with IT Admin receiving the full permission catalog. Reuse those permissions; do not add permission codes for AT-01.
- The platform exposes `UnitOfWorkPort` and `OutboxWriterPort`; Audit consumes versioned `audit.fact` Business Facts. Material topology changes should append their Audit facts atomically with their topology writes and use the established actor/source/time context.
- The repository has no shared seed runner. It has a platform Mongo migration runner and an IAM-specific admin bootstrap command. The approved AT-01 choice is to provision the default Data Center through the existing Mongo migration mechanism, not add an operator-run topology CLI.
- The existing Asset & Topology backend consumer contract already defines Asset, Rack, and Room-map queries. Keep that contract unchanged and do not bind a partial provider in AT-01; add a code comment that its provider is registered when the Asset and Rack query implementations are available.

## Proposed design

### Domain and use cases

- Add domain types for the seeded Data Center reference, Site, and Room. Site records carry their canonical ID, name, and Data Center reference. Room records carry their canonical ID, name, Site reference, and `RoomMap` dimensions/grid snap.
- Reuse `RoomMap` to enforce positive integer dimensions and grid snap. Do not persist derived grid cells.
- Add application use cases for retrieving the default Data Center; creating, retrieving, and updating Sites; and creating, retrieving, and updating Rooms. Site's Data Center reference and Room's Site reference are set at creation and immutable through update operations.
- Resolve the default Data Center through a stable domain identifier. Site creation must validate its Data Center parent; Room creation must validate its Site parent. Reject missing parents and invalid input before persistence. Failed updates leave the stored record unchanged.
- Keep Rack placement coordination out of this slice. The existing Room map policy remains the domain rule for proposed dimensions; per the approved decision, AT-02 will connect persisted Room updates to current Rack placements when Rack placement persistence exists, so a Room update cannot invalidate them.

### Persistence and bootstrap

- Store topology through Asset & Topology-owned Mongo schemas and repository adapters. Keep Mongoose types inside infrastructure.
- Add a Mongo migration using a deterministic Data Center ID/key and an idempotent upsert. It inserts the default Data Center when absent and does not create additional defaults when rerun. Flow 1 cannot modify this record.
- Do not seed topology from application startup or couple topology bootstrap to IAM's operator-managed initial-admin secret workflow.

### HTTP and authorization

- Add the Dashboard REST surface under `/api/v1/asset-topology` and describe it in a new `api/v1/asset-topology.yaml` contract. Keep this HTTP/OpenAPI contract separate from the Asset & Topology application contracts consumed by backend modules; AT-01 does not expand the consumer contract for Dashboard use.
- Provide `GET /data-centers/default`; provide nested Site collection create/list routes beneath the default Data Center and Site read/update routes; provide nested Room create/list routes beneath a Site and Room read/update routes.
- Protect reads with `asset:read` and mutations with both the `IT_ADMIN` role and `asset:manage`, using the existing IAM guards plus a controller role check and standard problem/response behavior. Do not add Data Center mutation routes.
- Validate request shapes and path IDs at the presentation boundary; map application/domain errors through the existing HTTP error mapping.

### Audit and consistency

- For each material Site or Room create/update, use the standard Unit of Work and append one `audit.fact` Business Fact to the Outbox describing the actor, action, allowlisted old/new scalar values, and occurrence time. The Audit module consumes the fact through the existing consumer path; Asset & Topology does not write Audit persistence directly.
- Keep topology persistence and Outbox fact append in the same transaction. Read-only operations and no-op updates emit no material-change fact.
- The current Audit record's `producer` field is the source attribution (`asset-topology`); do not add a new source field. Allocate a monotonically increasing Audit resource sequence per Site/Room in the same transaction as the write and Outbox append.
- The default Data Center migration is initial infrastructure provisioning and does not emit an Audit Fact. It remains idempotent and outside Flow 1 mutation routes.

## Acceptance mapping

1. Stable default Data Center exists through the Mongo migration; authorized reads return it, and Flow 1 has no create/update path.
2. Site and Room use cases enforce parent existence and expose authorized create/read/update operations.
3. Room dimensions and grid snap pass through `RoomMap`; invalid values are rejected and derived cells are not stored.
4. Application and persistence operations preserve prior state on invalid input or failed parent validation.
5. HTTP contracts, validation, permissions, standard errors, and existing Audit attribution are implemented with focused unit, adapter, controller, and migration tests.

## Explicitly deferred

- Rack, Asset, QR, label, maintenance, and retirement workflows belong to later tickets.
- Persistence-aware rejection of Room changes that invalidate current Rack placements must be completed with AT-02 when Rack placement persistence is introduced; the domain policy already exists.
- No new permission codes, shared seed framework, Audit storage, or cross-module persistence access are introduced.

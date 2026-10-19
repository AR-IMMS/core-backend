# AT-12 Asset & Topology Consumer Contracts Plan

> **For execution:** Use the `superpowers:executing-plans` workflow and `superpowers:test-driven-development` for the contract checks below.

**Goal:** Publish a stable internal application contract for canonical Asset/Rack queries and Asset-owned maintenance-state requests without exposing domain or persistence types or defining Dashboard HTTP/OpenAPI.

**Architecture:** Add a deliberately small contract surface under Asset & Topology, exported from its module public index. Keep DTOs and ports separate from domain entities. This ticket defines the public boundary only; later feature tickets implement the use cases/adapters and refine behavior. AT-13 continues to own Asset-Agent coordination and cross-domain contract decisions.

**Stack:** TypeScript, existing Jest and NestJS module conventions.

## Contract field mapping

| Query result field                                                               | Confirmed consumer/use case                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Asset `id`                                                                       | Dashboard selects the canonical Asset in Flow use cases 9.1–9.3.                                                                            |
| Asset `name`, `assetTypeId`                                                      | Dashboard identifies the Asset and its seeded Node type in registry/placement, 9.1–9.3.                                                     |
| Asset `lifecycleState`                                                           | Dashboard displays lifecycle state in inventory/detail, 9.1–9.3.                                                                            |
| Asset `currentPlacement: null \| { rackId, uPosition }`                          | Dashboard displays assigned/unassigned state and supports place/move/unmap, 9.1–9.3. `null` means unassigned; there is no parallel boolean. |
| Rack `id`                                                                        | Dashboard selects a canonical Rack in topology, placement, and QR lookup, 9.1–9.2 and 9.4.                                                  |
| Rack `uCapacity`                                                                 | Dashboard presents valid U positions for place/move, 9.1–9.2.                                                                               |
| Rack `currentLocation: null \| { roomId, xMm, yMm, widthMm, depthMm, rotation }` | Dashboard renders confirmed Rack placement on the Room map, 9.1–9.2. `null` means no current location.                                      |
| Room `id`, `widthMm`, `depthMm`, `gridSnapMm`                                    | Dashboard renders the Room map and visible placement constraints, 9.1–9.2.                                                                  |

Parent Site/Data Center IDs, model/serial fields, QR mappings, Agent binding, and health are omitted because no confirmed query use case in AT-12 establishes their need. A consumer ticket can add a field with an explicit use case.

## Tasks

1. **Write a failing contract boundary test first.** Assert the exported DTOs preserve nullable `currentPlacement`/`currentLocation` shapes, canonical IDs, and maintenance command types; assert consumer imports are sourced only from the public module index in a small compile-oriented fixture.
2. **Add contract types and public exports.** Define opaque ID types, read DTOs/query interface, optional current-location objects, a Maintenance-to-Asset state-change command interface, and one runtime Nest injection token in a contracts folder. Export the boundary from the module root. Do not export domain entities, persistence models, or Mongoose types.
3. **Add validated-command contract semantics.** Document that the Asset & Topology application use case validates its lifecycle rules and does not trust caller-supplied eligibility. Leave Activity coordination needed for the “no other executing Activity” rule open to AT-13/AT-05; do not choose coordinator, event, or query direction.
4. **Update the spec.** Clarify AT-FR-11/section 10 with the internal query fields and command boundary, optional current location as `null`, field-to-consumer/use-case mapping, and the explicit AT-13 unresolved items. Preserve the already modified spec contents and make no Dashboard API changes.
5. **Run focused checks.** Run the contract test and `pnpm typecheck`/`pnpm build` as appropriate; inspect scoped diff and ensure no unrelated user changes were modified.

## Out of scope

- Dashboard REST/OpenAPI endpoints or response models.
- Query/use-case implementations and persistence adapters.
- Maintenance Activity orchestration or Activity-state storage.
- Ticket Management and Agent Management contract implementations.
- Any Asset-Agent direction, coordinator, event, or read-model choice.
- Audit store changes; material-change tickets continue to reuse the existing Audit mechanism.

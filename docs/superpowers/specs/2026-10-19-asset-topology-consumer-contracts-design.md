# Asset & Topology Consumer Contracts Design

**Status:** Proposed for review
**Scope:** AT-12 (#36)

## Goal

Define the internal application boundary that authorized modules can use to reference canonical Assets and Racks, read confirmed topology and placement, and request Asset-owned maintenance-state changes. Dashboard REST/OpenAPI contracts remain part of the Dashboard feature tickets.

## Ownership and boundary

- Asset & Topology remains authoritative for Asset and Rack identity, lifecycle, topology, and Asset Location.
- Maintenance remains authoritative for Maintenance Activities and requests Asset state changes through the Asset & Topology application contract.
- Ticket Management remains authoritative for ticket assignment. AT-12 does not create a Ticket Management contract.
- Agent Management remains authoritative for Agent identity and binding. AT-12 does not select the Asset–Agent interaction direction or coordination mechanism; that remains for AT-13.
- Consumers receive application-level request/result types and cannot import Asset & Topology domain or persistence types.

## Contract surface

1. Export canonical `AssetId` and `RackId` contract types without exporting domain entities.
2. Provide application queries for a single Asset or Rack by canonical ID. Return only fields mapped to confirmed consumers and use cases:

   | Field                                                                                 | Consumer  | Use case                                                                                                                                     |
   | ------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
   | Asset `id`                                                                            | Dashboard | Select a canonical Asset for inventory/detail and placement workflows (Flow use cases 9.1–9.3).                                              |
   | Asset `name`, `assetTypeId`                                                           | Dashboard | Identify the Asset and its seeded Node type in registry and placement workflows (9.1–9.3).                                                   |
   | Asset `lifecycleState`                                                                | Dashboard | Display the Asset lifecycle state in inventory/detail views (9.1–9.3).                                                                       |
   | Asset `currentPlacement` (`null` or `{ rackId, uPosition }`)                          | Dashboard | Display current Rack/U position or unassigned status and choose move/unmap actions (9.1–9.3).                                                |
   | Rack `id`                                                                             | Dashboard | Select a canonical Rack in topology, placement, and QR lookup workflows (9.1, 9.2, 9.4).                                                     |
   | Rack `uCapacity`                                                                      | Dashboard | Present valid U positions when placing/moving a Node (9.1–9.2).                                                                              |
   | Rack `currentLocation` (`null` or `{ roomId, xMm, yMm, widthMm, depthMm, rotation }`) | Dashboard | Associate the Rack with a Room and render its confirmed footprint on the map, using the approved lower-left anchor/rotation rules (9.1–9.2). |
   | Room `id`, `widthMm`, `depthMm`, `gridSnapMm`                                         | Dashboard | Render the Room map and validate visible Rack map placement inputs (9.1–9.2).                                                                |

   `currentPlacement` and `currentLocation` are optional current-location objects represented as `null` when no current location exists; do not add separate placement-exists flags. The Dashboard consumer is confirmed by AT-12 and Flow 1 use cases 9.1–9.4. Rack `widthMm` and `depthMm` are needed to render a map footprint; Room dimensions and `gridSnapMm` are needed to render the map. Parent Site/Data Center identifiers are omitted because these confirmed use cases do not establish a need for them in these query results. Maintenance Activity coordination and Agent binding are owned by their respective modules and are not query fields in this contract.

3. Provide an application command for Maintenance to request the Asset lifecycle transition associated with an Activity entering or leaving `EXECUTE`. The Asset & Topology use case validates the Asset-owned lifecycle rules; it does not accept caller-provided authorization or eligibility as proof. Manual fallback authorization remains at the appropriate application boundary.
4. Leave coordination required to decide whether another Activity remains in `EXECUTE`, and the public contract interactions needed to perform that check, unresolved for AT-13 and the AT-05 implementation. Do not prescribe synchronous orchestration, events, or a coordinator here.

Expose one Nest provider token alongside the compile-time contract so future consumers can depend on the public boundary. AT-12 does not register a provider because the application use cases and adapters belong to later implementation tickets.

The command is a contract definition only in AT-12. Persistence, Activity coordination, manual authorization integration, audit attribution, and HTTP endpoints are implemented by their owning feature tickets.

## Compatibility and validation

- Contract DTOs are independent of domain and persistence representations; internal mapping can evolve without changing consumers.
- Keep canonical IDs stable and treat placement as `currentPlacement: null` or a populated object, never infer placement from lifecycle state.
- Add focused contract tests for the public DTO/port boundary and the validation behavior implemented by its application use case. Evolve compatibility tests with the feature tickets that add consumers.
- Do not add public Dashboard HTTP/OpenAPI schemas in AT-12.

## Explicitly unresolved

- Asset–Agent contract direction and coordination mechanism (AT-13).
- How Maintenance determines and communicates whether another Activity is still executing for an Asset (AT-13 / AT-05).
- Dashboard HTTP/OpenAPI paths and response shapes (Dashboard feature tickets).

# AT-13 Cross-domain Contracts and Asset–Agent Coordination

**Status:** Decisions approved; contract-owner dependencies tracked in AT-13
**Scope:** AT-13 (#37)

## Confirmed ownership

- Asset & Topology owns canonical Asset identity, lifecycle state, topology, and Asset Location. It supplies its own Asset facts and validates its own state changes through its application contract.
- Agent Management owns Agent identity and the Agent–Node binding. It validates and changes binding through its application contract.
- Maintenance owns Maintenance Activities and requests Asset state changes through the Asset & Topology contract established in AT-12.
- Ticket Management owns Ticket assignment and must answer whether the acting user is the current assignee of the Ticket linked to an Asset.
- No module reads another module's persistence or imports its domain/persistence types.

## Agreed Asset–Agent interaction

Use an Infrastructure Asset Management Flow-level application coordinator for operations that require both module contracts. The coordinator is the only layer that knows both public contracts; it does not own Asset or Agent data or move domain rules into `platform`/`shared`.

1. **Bind an Agent to a Node:** the coordinator obtains current Asset lifecycle and placement facts from Asset & Topology. A Node is eligible only when it is `ACTIVE` and has a current Asset Location. The coordinator then requests the binding through Agent Management, which remains authoritative for Agent-side eligibility and the resulting binding.
2. **Retire a Node:** the coordinator obtains binding status from Agent Management. It fails closed if binding status is unavailable or unknown, and requests retirement through Asset & Topology only after the result is confirmed unbound. Asset & Topology remains authoritative for its lifecycle, maintenance, and placement preconditions.

This removes a direct Asset ↔ Agent call cycle and avoids a stale Agent-binding read model for the synchronous retirement guard. The coordinator alone does not guarantee atomicity when bind and retire race concurrently. AT-10 must select and test a concurrency guard before claiming that concurrent operations cannot leave a retired-but-bound Node; do not imply that sequential coordinator calls solve this race.

## Contract responsibilities

| Contract owner    | Minimum public behavior                                                                                                                                                     | Used by                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Asset & Topology  | Read canonical Asset lifecycle and current placement; accept use-case-validated Asset lifecycle/retirement commands.                                                        | Flow coordinator and authorized consumers. |
| Agent Management  | Read confirmed Node binding status (`BOUND`, `UNBOUND`, or an unavailable/unknown result); execute Agent–Node binding commands and validate Agent-side binding eligibility. | Flow coordinator.                          |
| Maintenance       | Report whether an Asset has another Activity in `EXECUTE`, and request the Asset state transition through the AT-12 contract when Activity state changes.                   | Maintenance application use cases.         |
| Ticket Management | Check current assignment for `(ticketId, actorId)` at action time.                                                                                                          | Manual maintenance authorization.          |

The status shape and consistency guarantees are contract requirements, not permission to duplicate another domain's source-of-truth data. In particular, a cached or stale `UNBOUND` value is not sufficient to retire an Asset.

## Failure and consistency requirements

- If the binding check cannot be completed, Node retirement is rejected and Asset state is unchanged.
- If the Node's eligibility facts cannot be read, binding is rejected and Agent–Node binding is unchanged.
- If the current-assignee check cannot be completed, manual maintenance changes by a non-Admin are rejected.
- Maintenance may not request `ACTIVE` until it confirms that no linked Activity remains in `EXECUTE`; if that confirmation is unavailable, the transition must not be treated as successful.
- AT-10/AT-05 must define retry/idempotency and concurrent bind/retire handling in their implementation contracts. This design does not assert cross-module transaction support or choose a lock, reservation, compensation, or event protocol.

## Dependency tracking findings

- AT-05 is tracked by #42 and AT-10 by #47; these are Asset & Topology implementation tickets that consume cross-domain behavior, not owning-domain contract tickets.
- Repository search found no separate Maintenance, Ticket Management, or Agent Management contract issue. No owning person/team is identified in the approved material.
- Recommendation: reference #42 and #47 from AT-13 as implementation consumers, and create separate dependency issues only after an owning domain/project and accountable owner are identified. Until then, AT-13 remains the tracker for the missing contract agreements; do not assign an invented owner.

## Remaining implementation dependencies

1. AT-10 must select and test how concurrent bind and retirement are prevented; this design deliberately leaves the mechanism open.
2. No owning-domain contract issues or accountable owners were found for Maintenance, Ticket Management, or Agent Management. Per the approved decision, AT-13 remains the dependency tracker until the owning teams and owners are identified; link/create separate issues then.
3. AT-05 must define retry/idempotency and consistency behavior if an Asset maintenance-state command cannot be completed while Maintenance changes an Activity state.

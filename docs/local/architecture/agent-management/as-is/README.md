# Agent Management As-Is Architecture

These diagrams represent the implementation in `src/modules/agent-management`. They document the module after its application layer was organized by responsibility; they do not add behavior or describe a future design.

## Responsibility inventory

| Responsibility | Current owner and implementation |
| --- | --- |
| Human API authorization | IAM authenticates the human principal and checks `agent:manage`; the Fleet enrollment controllers map application errors to HTTP responses. |
| Enrollment eligibility | Asset & Topology owns Asset/Node state and active placement. Agent Management uses its public asset query. |
| Invitation and synchronization | Core use cases coordinate Fleet requests, eligibility checks, operation persistence, business association updates, and audit facts. |
| Business binding | Core owns the minimal binding projection and its query contract; this is not Fleet's technical registry. |
| Technical identity and lifecycle | Fleet Manager owns installation identity, enrollment, credentials, authentication, binding enforcement, and runtime state. Core calls protected Fleet HTTP adapters over mTLS. |
| Asset lifecycle coordination | Asset & Topology owns lifecycle operations; Agent Management delegates Fleet gate close/completion through the public lifecycle contract. |
| Persistence and audit | MongoDB stores Core operation and association state. Platform Events provides Unit of Work and the internal Outbox/Audit Fact writer. |

No Agent Management domain entity, value object, or domain policy class exists. Fleet-specific DTOs and adapter errors are external application contracts under `application/ports/fleet`; Core-owned eligibility, binding, and enrollment operation ports live with the relevant capability.

## Diagrams

- [Complete module class diagram](00-module-class-diagram.mmd) — use cases, business and Fleet ports, adapters, persistence stores, controllers, DI wiring, and Core module boundaries.
- [Business responsibilities and Fleet integration](02-fleet-integration.mmd) — eligibility, Core state ownership, Fleet technical authority, and the mTLS integration.

## Exact source references

The complete diagram is grounded in these files:

- Composition and exports: `src/modules/agent-management/agent-management.module.ts`; `src/modules/agent-management/contracts/agent-binding.contract.ts`; `src/modules/agent-management/contracts/agent-node-lifecycle.contract.ts`.
- Enrollment: `src/modules/agent-management/application/enrollment/request-fleet-invitation.use-case.ts`; `synchronize-fleet-enrollment.use-case.ts`; `enrollment-operation.port.ts`; `errors/fleet-operation-pending.error.ts`; `errors/node-eligibility.errors.ts`.
- Binding and eligibility: `src/modules/agent-management/application/binding/binding-projection.port.ts`; `src/modules/agent-management/application/ports/node-eligibility.port.ts`.
- Fleet contracts and lifecycle: `src/modules/agent-management/application/ports/fleet/fleet-invitation.port.ts`; `fleet-installation.port.ts`; `fleet-node-enrollment-gate.port.ts`; `fleet.types.ts`; `fleet-errors.ts`; `src/modules/agent-management/application/lifecycle/coordinate-node-lifecycle.use-case.ts`.
- HTTP and IAM: `src/modules/agent-management/presentation/fleet-enrollment/fleet-invitation.controller.ts`; `fleet-enrollment-sync.controller.ts`; `src/modules/iam/presentation/authorization.decorators.ts`.
- Fleet adapters and DI: `src/modules/agent-management/infrastructure/fleet/fleet-manager-adapter.module.ts`; `fleet-http-client.ts`; `fleet-installation.http-adapter.ts`; `fleet-invitation.http-adapter.ts`; `fleet-node-enrollment-gate.http-adapter.ts`; `disabled-fleet-ports.ts`.
- Mongo persistence: `src/modules/agent-management/infrastructure/mongodb/mongo-fleet-binding-projection.store.ts`; `mongo-fleet-enrollment-operation.store.ts`; `fleet-mongo.types.ts`; `src/modules/agent-management/infrastructure/mongodb/migrations/fleet-binding-projection.migration.ts`; `fleet-enrollment-operation.migration.ts`.
- Cross-module contracts and lifecycle: `src/modules/asset-topology/asset-topology.module.ts`; `src/modules/asset-topology/contracts/asset-topology.contract.ts`; `src/modules/asset-topology/application/assets/retire-asset.use-case.ts`; `src/modules/asset-topology/application/placements/asset-placement-management.use-case.ts`; `src/modules/asset-topology/application/lifecycle/node-lifecycle-orchestrator.ts`; `src/platform/events/index.ts`.

The business/Fleet diagram follows the use cases and ports above, Asset & Topology's exported query and lifecycle orchestrator, Fleet adapter implementations, and Mongo stores. Paths are relative to the repository root. The module reorganization did not change Fleet adapter implementation bodies, HTTP contracts, persistence schemas, migration order, or Asset lifecycle behavior.

# Agent Management As-Is Architecture

These diagrams describe the cleaned implementation in `src/modules/agent-management` after the Fleet-only ownership cleanup. They are implementation evidence, not a target design. Core contains no technical Agent identity, credential, enrollment, registry, session, or revocation implementation.

## Ownership and responsibilities

| Responsibility | Current implementation and owner |
| --- | --- |
| Human API authorization | IAM authenticates the human principal and checks `agent:manage`; the Fleet controllers map application errors to HTTP responses. |
| Enrollment eligibility | Asset & Topology owns Asset/Node state and active placement; Agent Management consumes its public asset-query contract. |
| Invitation request and retry state | Core `RequestFleetInvitationUseCase`, Fleet invitation/installation ports, and the Mongo Fleet enrollment-operation store. Fleet executes invitation creation. |
| Enrollment synchronization | Core reads Fleet invitation and installation status, rechecks business eligibility, stores the minimal `fleet:<invitationId>` binding projection and operation status, and records an audit fact. |
| Technical identity and lifecycle | Fleet Manager owns the technical registry, credentials, enrollment, authentication, and runtime state. Core invokes Fleet through the protected mTLS HTTP adapters. |
| Asset lifecycle coordination | Asset & Topology owns lifecycle operations; the public Agent Node lifecycle contract delegates its Fleet gate to Fleet Manager. |
| Persistence and audit | MongoDB stores Core operation/projection data. Platform Events supplies Unit of Work and the internal Outbox/Audit Fact writer. |

No Agent Management domain entity, value object, or domain policy class exists in the cleaned module. Core operation records and the binding projection are infrastructure persistence documents; application ports and response types describe their use. The retained historical migrations for deleted Core collections remain registered to preserve applied migration history and ordering; they do not imply those deleted stores are active.

## Diagrams

- [Complete module class diagram](00-module-class-diagram.mmd) — application use cases, ports, Fleet adapters, persistence stores, controllers, DI, public contracts, and external boundaries.
- [Business and Fleet responsibilities](02-fleet-integration.mmd) — the business eligibility and lifecycle gates around the Fleet technical control plane.

The former `01-core-owned-lifecycle.mmd` has been removed because it represented deleted Core-owned enrollment, credential, access, and registry implementations.

## Historical architecture documents

The current ownership boundary supersedes legacy ownership assumptions in `docs/local/architecture/agent-management-fleet-cleanup-plan.md`, `docs/local/architecture/fleet-manager-core-integration-design.md`, and `docs/local/handoffs/agent-management-implementation-handoff.md`. Those documents may still describe Core-owned technical enrollment, credentials, or registry work; use this README and the checked-in implementation as the current As-Is record. This cleanup did not rewrite those historical documents.

## Exact source references

The complete diagram is based on:

- Composition and public exports: `src/modules/agent-management/agent-management.module.ts`; `contracts/agent-binding.contract.ts`; `contracts/agent-node-lifecycle.contract.ts`.
- Application flows and ports: `application/fleet/use-cases/request-fleet-invitation.use-case.ts`; `synchronize-fleet-enrollment.use-case.ts`; `coordinate-node-lifecycle.use-case.ts`; `application/fleet/ports/*.ts`; `application/fleet/fleet.types.ts`; `application/fleet/errors/*.ts`.
- HTTP and IAM: `presentation/fleet-enrollment/fleet-invitation.controller.ts`; `fleet-enrollment-sync.controller.ts`; `src/modules/iam/presentation/authorization.decorators.ts`.
- Fleet adapters and DI: `infrastructure/fleet/fleet-manager-adapter.module.ts`; `fleet-http-client.ts`; `fleet-installation.http-adapter.ts`; `fleet-invitation.http-adapter.ts`; `fleet-node-enrollment-gate.http-adapter.ts`; `disabled-fleet-ports.ts`.
- Mongo stores: `infrastructure/mongodb/mongo-fleet-binding-projection.store.ts`; `mongo-fleet-enrollment-operation.store.ts`; `fleet-mongo.types.ts`; `migrations/fleet-binding-projection.migration.ts`; `migrations/fleet-enrollment-operation.migration.ts`.
- Cross-module wiring: `src/modules/asset-topology/asset-topology.module.ts`; `src/modules/asset-topology/contracts/asset-topology.contract.ts`; `src/modules/asset-topology/application/assets/retire-asset.use-case.ts`; `src/modules/asset-topology/application/placements/asset-placement-management.use-case.ts`; `src/modules/asset-topology/application/lifecycle/node-lifecycle-orchestrator.ts`; `src/platform/events/index.ts`.

The business/Fleet diagram uses the application use cases and ports above, Asset & Topology's exported asset query and the lifecycle orchestrator. The source links are paths relative to the repository root.

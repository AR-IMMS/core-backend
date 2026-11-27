# Agent Management

Agent Management is Core's business boundary for Fleet enrollment requests, enrollment synchronization, and Node lifecycle coordination. Fleet Manager is authoritative for Agent installation identity, enrollment, credentials, registry, and technical lifecycle. Core keeps only invitation orchestration records and a minimal Fleet binding projection used by business rules.

## Responsibilities

- `RequestFleetInvitationUseCase` checks Node business eligibility, rejects an existing local projection or Fleet installation binding, and requests an invitation from Fleet with idempotency.
- `SynchronizeFleetEnrollmentUseCase` reads Fleet invitation and installation state, rechecks Node eligibility, records an active business binding projection and operation outcome, and writes an audit fact.
- `CoordinateNodeLifecycleUseCase` implements the public lifecycle contract by delegating gate close/restore operations to Fleet.
- Fleet HTTP adapters use the shared mTLS client. Disabled adapters fail through the same ports when Fleet is not configured.
- MongoDB stores Core-owned Fleet invitation operation state and the minimal Fleet binding projection. These stores do not own credentials or the technical Agent registry.
- The module exports only `AgentBindingQueries` and `AgentNodeLifecycleCoordination` for Asset & Topology.

There are no Agent Management domain entities, value objects, or domain policy classes. Eligibility errors and Fleet operation errors are application errors; Fleet and Mongo interfaces are application ports with infrastructure implementations.

## HTTP surface

- `POST /api/v1/nodes/{nodeId}/agent-fleet-invitations` requests an invitation.
- `POST /api/v1/agent-fleet-invitations/{invitationId}/synchronize` synchronizes Fleet enrollment state.

Both endpoints require a human principal and `agent:manage`. Core bootstrap-token issuance, direct enrollment, local revocation, and Core registry endpoints have been removed. The OpenAPI source is `api/v1/agent-enrollment.yaml`.

## Configuration

Fleet integration is configured through `FLEET_MANAGER_BASE_URL`, client certificate/key (inline PEM or file path), optional CA certificate, and the Fleet request timeout/retry settings. No Core Agent credential, recovery cipher, or control-plane URL configuration remains.

See [As-Is diagrams](../../../docs/local/architecture/agent-management/as-is/README.md) for class diagrams and exact source references.

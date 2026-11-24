# Agent Management → Fleet Integration Cleanup Plan

**Status:** Core lifecycle-gate slice and safe code-only cleanup implemented. Fleet wire agreement and real Fleet support remain pending.

**Goal:** Keep Core's human-facing Agent Management behavior and Node association in Core, isolate the Fleet HTTP adapter, and retire Core-owned enrollment state only after an approved cutover and rollback plan.

**Evidence note:** The shared Fleet contracts submodule is unavailable in this worktree. The C01/C04 positions referenced below are those already cited in [the integration design](fleet-manager-core-integration-design.md); re-check the pinned shared documents with Fleet/Agent owners before contract approval. Repository search found no first-party dashboard/client implementation here, so this slice keeps `Idempotency-Key` optional and adds an operation-status/retry path.

## Current-to-target classification

| Responsibility / current paths | Classification | Proposed disposition |
| --- | --- | --- |
| `presentation/fleet-enrollment/fleet-invitation.controller.ts`, `fleet-enrollment-sync.controller.ts`; `application/fleet/use-cases/request-fleet-invitation.use-case.ts`, `synchronize-fleet-enrollment.use-case.ts` | Keep as Core-owned behavior | Keep IAM authorization, Node eligibility, invitation request API, explicit status synchronization, Core binding association, and business audit in Agent Management. Keep Fleet calls behind application ports. |
| `application/fleet/ports/fleet-enrollment-operation.port.ts`, `fleet-binding-projection.port.ts`; `infrastructure/mongodb/mongo-fleet-enrollment-operation.store.ts`, `mongo-fleet-binding-projection.store.ts`; Fleet migrations | Keep as Core-owned behavior | Retain the minimum nonsecret retry journal and Core-owned Node ↔ installation projection. Do not copy Fleet credential, invitation-secret, session, or authoritative registry state. Extend the operation journal only for Core Node lifecycle recovery. |
| `contracts/agent-binding.contract.ts`, `contracts/agent-node-lifecycle.contract.ts`; Asset & Topology retirement, `unmap()`, and lifecycle journal | Keep as Core-owned behavior | Implemented: Asset & Topology owns Node mutation/journal; Agent Management exposes close/complete gate coordination. `Idempotency-Key` is optional for compatibility. Legacy enrollment keeps its transaction serialization. |
| IAM principal/permission decorators and Audit Fact v2 outbox | Keep as Core-owned behavior | Core continues to authenticate the human, authorize `agent:manage`, supply verified actor context, and audit its business decisions. Never accept a caller-supplied actor as authority. |
| `infrastructure/fleet/fleet-http-client.ts`, Fleet HTTP adapters, disabled ports, `FleetManagerAdapterModule`; `agent-management.module.ts` | Replace with Fleet integration / thin adapter | Implemented: one shared client/provider composes invitation, installation-read, and node-gate adapters. `AgentManagementModule` remains the Core business feature module. |
| Fleet installation and gate ports/adapters | Replace with Fleet integration / thin adapter | Implemented: installation reads and gate coordination are separate. Unused Fleet `revoke()` was removed after consumer search; add a revoke port only with a concrete revoke use case. |
| `presentation/agent-registry/AgentRegistryController`, `application/agent-registry/*`, `MongoAgentRegistryQueryStore` | Core API stays; Fleet reads replace for Fleet cohort | Preserve the user-facing route and IAM checks. For Fleet installations, read Fleet through the adapter; retain the local query path for legacy Core installations during overlap. Mark/route data by enrollment source so a Core historical record is never presented as authoritative Fleet state. |
| `presentation/access-lifecycle/AgentBindingRevocationController`, `RevokeAgentBindingUseCase`, `MongoAgentAccessStore` | Core API stays; Fleet revoke replaces for Fleet cohort | Keep the user-facing authorization and Core audit. For Fleet-owned installations, implement durable Fleet-revoke → Core-unlink retry state before routing to Fleet. Keep current Core-only behavior for legacy bindings until cutover. `MongoAgentAccessStore` remains needed for legacy revoke until then. |
| `presentation/registration/BootstrapTokenController`, `EnrollmentController`; `application/registration/*`; bootstrap-token/enrollment persistence and recovery cipher | Legacy-only: remove after cutover and migration | Preserve both endpoints and behavior throughout overlap. Remove only after Agent/Fleet/Core cutover is approved, Fleet is the only enrollment authority for the cohort, recovery windows have elapsed, and rollback has been rehearsed. |
| Legacy collections `agent_management_bootstrap_tokens`, `agent_management_enrollment_attempts`, `agent_management_enrollment_recovery`, `agent_management_installations`, `agent_management_credentials`, `agent_management_bindings`; `bootstrap-token-indexes.migration.ts`, `enrollment-indexes.migration.ts`, `enrollment-recovery.migration.ts`, `agent-access-indexes.migration.ts`, `agent-registry-query-indexes.migration.ts` registered by `migrations.ts` | Legacy-only data and migration: retain until cutover/retention approval | Do not drop collections, indexes, credential hashes, enrollment recovery, or migration records as part of code cleanup. First define UUID mapping, credential authority, audit/history retention, restore/rollback, and migration verification. Keep `fleet-enrollment-operation.migration.ts` and `fleet-binding-projection.migration.ts` for the Core Fleet baseline. |
| `test/agent-bootstrap.integration.ts`, `test/agent-enrollment.integration.ts`, `test/agent-access.integration.ts`, `test/asset-retirement.integration.ts`, and registration/access `*.spec.ts` | Keep as legacy regression coverage until cutover | Continue exercising existing Core enrollment, credential revocation and retirement behavior while the old endpoints and data remain. Remove or replace only in the migration change after each legacy cohort is verified. |
| `AGENT_CONTROL_PLANE_BASE_URL`, `AGENT_ENROLLMENT_RECOVERY_KEY` and associated configuration validation | Legacy-only: remove after cutover | Retain while the Core enrollment/recovery path is enabled. Remove the variables and secret-manager entries only with the legacy endpoint/cipher retirement and documented credential/key retirement procedure. |
| Agent authentication guard/decorator scaffolding and credential-hash authorization lookup | Removable now; removed after consumer search | Production source had no guard caller; references were limited to the scaffolding, module registration, and guard-only tests. Those were removed. Legacy credential records, index migration, and Core revoke remain. The Agent access regression still verifies human authorization on revoke. |
| Fleet installation `revoke()` surface | Removable now; removed after consumer search | No production use case depended on it. The method and its adapter-only test were removed; legacy Core revoke is unchanged. |
| Any legacy endpoint, persisted data, migration, credential hash, invitation/installation record, or shared Fleet contract | Not removable now | No verified cutover, data migration, rollback plan, or shared-contract approval is present in this worktree. |

## Proposed target structure

```text
src/modules/agent-management/
  contracts/
    agent-binding.contract.ts                  # Asset-facing binding/lifecycle contract
    node-lifecycle.contract.ts                 # close/complete coordination contract
  application/
    fleet/                                      # invitation, sync, projection, operation state
      ports/fleet-invitation.port.ts
      ports/fleet-installation-query.port.ts
      ports/fleet-node-enrollment-gate.port.ts
      use-cases/request-fleet-invitation.use-case.ts
      use-cases/synchronize-fleet-enrollment.use-case.ts
      use-cases/coordinate-fleet-node-gate.use-case.ts # implements Agent-facing gate contract
    agent-registry/                             # Core API; Fleet read for Fleet cohort
    access-lifecycle/                           # Fleet-aware revoke added after contract approval
  presentation/
    fleet-enrollment/                           # Core human API, IAM and response mapping
    agent-registry/                              # Stable authorized user API
    access-lifecycle/                            # Stable revoke API
    registration/                                # legacy-only until cutover
  infrastructure/
    fleet/
      fleet-manager-adapter.module.ts            # HTTP/mTLS adapters only
      fleet-http-client.ts
      fleet-invitation.http-adapter.ts
      fleet-installation-query.http-adapter.ts
      fleet-node-enrollment-gate.http-adapter.ts
      # fleet-revoke.http-adapter.ts only with concrete revoke use case
    mongodb/
      mongo-fleet-enrollment-operation.store.ts   # nonsecret retry/recovery state
      mongo-fleet-binding-projection.store.ts     # Core business association
      legacy registration/access/registry stores  # remove after cutover only
  agent-management.module.ts                     # Core API and use-case composition

src/modules/asset-topology/
  application/lifecycle/                        # implemented orchestrator and journal port
  application/assets/retire-asset.use-case.ts    # gate around retirement
  application/placements/asset-placement-management.use-case.ts # gate around unmap
  infrastructure/mongodb/mongo-node-lifecycle-operation.store.ts
  presentation/assets/node-lifecycle-operation.controller.ts # pending view and same-ID retry
```

`FleetManagerAdapterModule` is the explicit subsystem-adapter module. It contains transport and protocol translation only. `AgentManagementModule` remains the Core feature module because it owns the human API, permission checks, Node authorization, association, audit, and legacy coexistence. This avoids renaming a business module into a misleading infrastructure adapter.

## Core implementation status and remaining work

### Cross-system gate contract agreement (Fleet/Agent prerequisite)

- Agree with Fleet and Agent on close serialization against **both** invitation creation and enrollment exchange, returned active-binding identifiers, same-operation replay, different-owner conflict, compare-and-complete behavior, abort restoration of `previous_state`, and durable recovery after an unresolved owner.
- Propose close-time cancellation of pending invitations for unassignment/retirement, but mark it as an unapproved Fleet capability until Fleet confirms it. The Core fake does not model cancellation; Core must not claim real Fleet supports it.
- Decide how a later authorized placement/reactivation opens a gate. A committed unassignment/retirement leaves it closed.
- Update C01/shared schemas only after owners approve the contract; this design/plan does not modify them.

### Core gate orchestration and lifecycle recovery (implemented)

- Added `AgentNodeLifecycleCoordination` and narrow close/complete `FleetNodeEnrollmentGatePort`; active-binding result is returned atomically with the proposed Fleet gate response.
- Added the Asset-owned Mongo operation journal, unique pending-Node/key indexes, optional Idempotency-Key, safe pending visibility, and same-operation retry. The request key is hashed; the journal contains no secret.
- Wrapped retire/unmap in gate close → Core transaction + lifecycle Audit Fact + durable outcome → versioned gate finalize/restore. Core retains the gate closed for unknown transaction/finalization outcomes.
- Legacy unmap now writes the Asset revision used by the existing Agent enrollment serialization command, covering the legacy unmap/exchange race while legacy enrollment remains enabled.
- Focused unit tests cover journal concurrency, idempotency conflicts, prior-closed restoration, lost commit acknowledgments, remote timeouts, completion retry, and unmap serialization. CI includes these tests and the existing M1 enrollment/retirement regressions. The separate Mongo replica-set integration script includes legacy enrollment races against retire/unmap but requires a configured Mongo test service.
- Verification is Core-only with fake Fleet. It cannot establish that production Fleet serializes gate close against invitation creation/exchange or rejects stale owner/version updates.

### Adapter module extraction and unused-surface cleanup (implemented)

- Extracted shared Fleet HTTP composition to `FleetManagerAdapterModule`; kept `AgentManagementModule` as the Core feature module.
- Split installation reads and gate operations into separate ports/adapters. Fleet revoke remains unimplemented and the unused method is removed.
- Removed unused Agent credential-auth guard scaffolding after checking production callers. Preserved legacy routes, credential data, indexes, migrations, and Core revoke.
- Added the gate/journal/retry HTTP contract and OpenAPI changes. Unit and CI verification results are recorded with the implementation report; real Fleet/Supervisor acceptance remains blocked on external service capabilities.

### 3. Deferred legacy cutover and data retirement (separate approved work)

- Define per-installation authority and UUID migration, Core/Fleet registry read behavior, credential/session rotation, audit history, rollback, and support runbook with Fleet/Agent/product owners.
- Migrate and verify a cohort; keep Core legacy endpoints enabled for unmigrated installations and rollback.
- Only after measured zero legacy traffic and rollback-window expiry, remove legacy controllers/use cases/configuration and plan collection/index/key retirement as a separate reviewed migration. Do not delete historical audit or migration records implicitly.

## Review decisions

1. The Core baseline uses operation ownership/version checks and restores `previous_state` on abort; Fleet still must agree and implement the atomic semantics.
2. Approve the module split: `AgentManagementModule` remains Core business composition; `FleetManagerAdapterModule` names the outbound Fleet adapter.
3. Code-only cleanup is complete: unused Agent credential-auth scaffolding and unused Fleet adapter revoke were removed after consumer checks. Legacy credentials, data, migrations, public endpoints, and Core revoke remain.
4. Confirm the future gate-open trigger after a Node becomes eligible again and the desired disposition of pending invitations after final retirement.

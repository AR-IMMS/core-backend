# Agent Management → Fleet Integration Cleanup Plan

**Status:** Implementation plan updated for the approved Core lifecycle-gate slice. Fleet wire agreement remains pending.

**Goal:** Keep Core's human-facing Agent Management behavior and Node association in Core, isolate the Fleet HTTP adapter, and retire Core-owned enrollment state only after an approved cutover and rollback plan.

**Evidence note:** The shared Fleet contracts submodule is unavailable in this worktree. The C01/C04 positions referenced below are those already cited in [the integration design](fleet-manager-core-integration-design.md); re-check the pinned shared documents with Fleet/Agent owners before contract approval. Repository search found no first-party dashboard/client implementation here, so this slice keeps `Idempotency-Key` optional and adds an operation-status/retry path.

## Current-to-target classification

| Responsibility / current paths | Classification | Proposed disposition |
| --- | --- | --- |
| `presentation/fleet-enrollment/fleet-invitation.controller.ts`, `fleet-enrollment-sync.controller.ts`; `application/fleet/use-cases/request-fleet-invitation.use-case.ts`, `synchronize-fleet-enrollment.use-case.ts` | Keep as Core-owned behavior | Keep IAM authorization, Node eligibility, invitation request API, explicit status synchronization, Core binding association, and business audit in Agent Management. Keep Fleet calls behind application ports. |
| `application/fleet/ports/fleet-enrollment-operation.port.ts`, `fleet-binding-projection.port.ts`; `infrastructure/mongodb/mongo-fleet-enrollment-operation.store.ts`, `mongo-fleet-binding-projection.store.ts`; Fleet migrations | Keep as Core-owned behavior | Retain the minimum nonsecret retry journal and Core-owned Node ↔ installation projection. Do not copy Fleet credential, invitation-secret, session, or authoritative registry state. Extend the operation journal only for Core Node lifecycle recovery. |
| `contracts/agent-binding.contract.ts`; Asset & Topology `RetireAssetUseCase`, placement `unmap()`, and `asset-topology.contract.ts` | Keep as Core-owned behavior | Preserve the public module boundary. Add an explicit Node lifecycle coordination contract when implementing the gate. Asset & Topology owns its Node mutations; Agent Management exposes only the authorized coordination result. |
| IAM principal/permission decorators and Audit Fact v2 outbox | Keep as Core-owned behavior | Core continues to authenticate the human, authorize `agent:manage`, supply verified actor context, and audit its business decisions. Never accept a caller-supplied actor as authority. |
| `infrastructure/fleet/fleet-http-client.ts`, `fleet-invitation.http-adapter.ts`, `fleet-installation.http-adapter.ts`, `disabled-fleet-ports.ts`; duplicated provider factories in `agent-management.module.ts` | Replace with Fleet integration / thin adapter | Keep the Core application ports in Agent Management. Move HTTP client construction, mTLS, response decoding, safe errors, retry, invitation/installation adapters, and the node-gate adapter into `FleetManagerAdapterModule` under `src/modules/agent-management/infrastructure/fleet/`. Register one shared configured client. This removes real client-construction duplication; keep `AgentManagementModule` named for its broader Core business responsibility. |
| `application/fleet/ports/fleet-installation.port.ts` and `FleetInstallationHttpAdapter` | Replace with Fleet integration / thin adapter | Split installation reads from `FleetNodeEnrollmentGatePort`. Do not mix gate lifecycle with installation lookup. Remove the unused `revoke()` method from this port and adapter; add a purpose-specific revoke port when the Core revoke use case is actually implemented. |
| `presentation/agent-registry/AgentRegistryController`, `application/agent-registry/*`, `MongoAgentRegistryQueryStore` | Core API stays; Fleet reads replace for Fleet cohort | Preserve the user-facing route and IAM checks. For Fleet installations, read Fleet through the adapter; retain the local query path for legacy Core installations during overlap. Mark/route data by enrollment source so a Core historical record is never presented as authoritative Fleet state. |
| `presentation/access-lifecycle/AgentBindingRevocationController`, `RevokeAgentBindingUseCase`, `MongoAgentAccessStore` | Core API stays; Fleet revoke replaces for Fleet cohort | Keep the user-facing authorization and Core audit. For Fleet-owned installations, implement durable Fleet-revoke → Core-unlink retry state before routing to Fleet. Keep current Core-only behavior for legacy bindings until cutover. `MongoAgentAccessStore` remains needed for legacy revoke until then. |
| `presentation/registration/BootstrapTokenController`, `EnrollmentController`; `application/registration/*`; bootstrap-token/enrollment persistence and recovery cipher | Legacy-only: remove after cutover and migration | Preserve both endpoints and behavior throughout overlap. Remove only after Agent/Fleet/Core cutover is approved, Fleet is the only enrollment authority for the cohort, recovery windows have elapsed, and rollback has been rehearsed. |
| Legacy collections `agent_management_bootstrap_tokens`, `agent_management_enrollment_attempts`, `agent_management_enrollment_recovery`, `agent_management_installations`, `agent_management_credentials`, `agent_management_bindings`; `bootstrap-token-indexes.migration.ts`, `enrollment-indexes.migration.ts`, `enrollment-recovery.migration.ts`, `agent-access-indexes.migration.ts`, `agent-registry-query-indexes.migration.ts` registered by `migrations.ts` | Legacy-only data and migration: retain until cutover/retention approval | Do not drop collections, indexes, credential hashes, enrollment recovery, or migration records as part of code cleanup. First define UUID mapping, credential authority, audit/history retention, restore/rollback, and migration verification. Keep `fleet-enrollment-operation.migration.ts` and `fleet-binding-projection.migration.ts` for the Core Fleet baseline. |
| `test/agent-bootstrap.integration.ts`, `test/agent-enrollment.integration.ts`, `test/agent-access.integration.ts`, `test/asset-retirement.integration.ts`, and registration/access `*.spec.ts` | Keep as legacy regression coverage until cutover | Continue exercising existing Core enrollment, credential revocation and retirement behavior while the old endpoints and data remain. Remove or replace only in the migration change after each legacy cohort is verified. |
| `AGENT_CONTROL_PLANE_BASE_URL`, `AGENT_ENROLLMENT_RECOVERY_KEY` and associated configuration validation | Legacy-only: remove after cutover | Retain while the Core enrollment/recovery path is enabled. Remove the variables and secret-manager entries only with the legacy endpoint/cipher retirement and documented credential/key retirement procedure. |
| `presentation/access-lifecycle/agent-authentication.guard.ts`, `agent-authenticated.decorator.ts`, `application/access-lifecycle/ports/agent-credential-authorization.port.ts`, and `MongoAgentAccessStore.findActivePrincipalByCredentialHash()` | Removable now as unused Core route scaffolding, subject to final consumer search | Current production source has no `@AgentAuthenticated()` caller. References are the guard/decorator themselves and module registration; `docs/local/business/flow-02-agent-enrollment-server-design.md` says no production operation currently accepts an Agent credential. Remove these classes/provider/authorization method and their guard-only tests together if review confirms no downstream package imports them. Preserve the legacy credential records, index migration, and revoke implementation. |
| `FleetInstallationPort.revoke()` and the matching HTTP adapter method | Removable now as an unused outbound method | No production application use case calls it; only its adapter-level test exercises the request. Remove the unused method/test until a concrete Fleet revoke workflow is implemented. This does not remove or change the legacy Core revoke endpoint. |
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
  application/assets/retire-asset.use-case.ts    # gate around retirement
  application/placements/asset-placement-management.use-case.ts # gate around unmap
  application/assets/node-lifecycle-operation.port.ts # Asset-owned operation journal
  infrastructure/mongodb/mongo-node-lifecycle-operation.store.ts
```

`FleetManagerAdapterModule` is the explicit subsystem-adapter module. It contains transport and protocol translation only. `AgentManagementModule` remains the Core feature module because it owns the human API, permission checks, Node authorization, association, audit, and legacy coexistence. This avoids renaming a business module into a misleading infrastructure adapter.

## Focused implementation plan for review

### 0. Cross-system gate contract agreement (production prerequisite; Core fake can proceed)

- Agree with Fleet and Agent on close serialization against **both** invitation creation and enrollment exchange, returned active-binding identifiers, same-operation replay, different-owner conflict, compare-and-complete behavior, abort restoration of `previous_state`, and durable recovery after an unresolved owner.
- Propose close-time cancellation of pending invitations for unassignment/retirement, but mark it as an unapproved Fleet capability until Fleet confirms it. The fake models the proposal; Core must not claim real Fleet supports it.
- Decide how a later authorized placement/reactivation opens a gate. A committed unassignment/retirement leaves it closed.
- Update C01/shared schemas only after owners approve the contract; this design/plan does not modify them.

### 1. Core gate orchestration and lifecycle recovery

- Add the public Agent Management lifecycle contract and narrow `FleetNodeEnrollmentGatePort` (`close` / `complete` only); include previous gate state and split it from installation lookup/revoke.
- Add an Asset-owned one-active-operation-per-Node journal. `Idempotency-Key` remains optional during migration: keyed calls resume by hash/fingerprint; no-key callers reuse a matching pending Node/action/actor operation or receive its safe operation ID. Persist identity and stage before Fleet HTTP; never store secrets.
- Add admin-only pending-operation list and same-operation retry endpoints plus an operator retry procedure; update `api/v1/asset-topology.yaml` while preserving existing required headers and 204 success behavior. Do not make the new header mandatory without downstream-client migration.
- Wrap both Asset retirement and placement `unmap()` with: journal start/resume → Fleet gate close → apply current lifecycle rule → Core transaction + Audit Fact + committed operation outcome in one Mongo transaction → Fleet `COMMIT` or restore `previous_state` on `ABORT` → journal completion.
- Make legacy `serializeAgentEnrollmentEligibility()` and lifecycle `unmap()` write the same Asset document revision in their transaction. Keep the existing retirement Asset write lock. This makes a race serialize/abort one transaction while legacy enrollment is enabled.
- On returned binding: reject retirement; allow unassignment under the current rule and leave the binding intact. Do not reopen after a committed lifecycle change.
- Test two concurrent Node operations, close-vs-create/exchange ordering, fake cancellation of pending invitations, existing binding response, prior-closed abort restoration, stale owner/version, same-key/different-payload conflict, no-key compatibility, timeout on close/complete, Core failure after close, process restart before/after Core commit, durable outcome not inferred from Node state, operator listing/retry, retirement rejection, unassignment preserving the binding, journal uniqueness/migration, and legacy Core enrollment racing both retirement and unmap.
- Use a contract-shaped fake Fleet with atomic per-Node serialization. Label this as Core behavior verification, not real Fleet conformance.

### 2. Adapter module extraction and unused-surface cleanup

- Move client/adapters and one shared client provider into `infrastructure/fleet/fleet-manager-adapter.module.ts`; keep application-owned ports outside the adapter implementation and expose only the intended Core port tokens.
- Add the dedicated gate adapter. Keep invitation and installation HTTP responsibilities separate.
- Remove the unused Fleet `revoke()` port method and test after the consumer check; remove Agent auth guard scaffolding only after the final production-consumer check. Preserve legacy revoke, credential documents, indexes and migrations.
- Add module wiring/adapter tests and verify no controller depends directly on an adapter. Run the fake gate suite, legacy Agent bootstrap/enrollment/access regressions, changed-file lint/format, full CI tests and build.

### 3. Deferred legacy cutover and data retirement (separate approved work)

- Define per-installation authority and UUID migration, Core/Fleet registry read behavior, credential/session rotation, audit history, rollback, and support runbook with Fleet/Agent/product owners.
- Migrate and verify a cohort; keep Core legacy endpoints enabled for unmigrated installations and rollback.
- Only after measured zero legacy traffic and rollback-window expiry, remove legacy controllers/use cases/configuration and plan collection/index/key retirement as a separate reviewed migration. Do not delete historical audit or migration records implicitly.

## Review decisions

1. The Core baseline uses operation ownership/version checks and restores `previous_state` on abort; Fleet still must agree and implement the atomic semantics.
2. Approve the module split: `AgentManagementModule` remains Core business composition; `FleetManagerAdapterModule` names the outbound Fleet adapter.
3. Confirm whether the two unused code surfaces listed above may be removed in a code-only cleanup while preserving all legacy data and public endpoints.
4. Confirm the future gate-open trigger after a Node becomes eligible again and the desired disposition of pending invitations after final retirement.

# Core Fleet Integration Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a Core-owned, testable Fleet Manager integration boundary while retaining existing Core enrollment behavior until an approved cutover.

**Architecture:** Agent Management application use cases depend on narrow invitation and installation ports. Infrastructure implements an HTTPS Fleet client with mTLS service identity, safe bounded retry, and typed errors; Core retains IAM, Node checks, audit, and local binding projection. The ordinary CI path uses a contract-shaped fake Fleet and makes no claim about live interoperability.

**Tech Stack:** NestJS 11, TypeScript 5.9, Jest, MongoDB/Mongoose, Node HTTPS.

**Spec:** `docs/local/architecture/fleet-manager-core-integration-design.md`; C01/C04 drafts under `docs/shared/contracts/fleet-management/`.

## Global Constraints

- Do not change `docs/shared` contracts or the `docs/shared` gitlink.
- Keep the legacy bootstrap-token/enrollment/revocation paths available and behaviorally unchanged.
- Use verified IAM principal context; ignore any request-supplied actor identity.
- Never persist or log Fleet invitation/installation secrets in Core.
- Fail closed when Fleet state cannot be checked for a destructive or eligibility decision.
- Do not add a dependency.
- Cross-system REST schemas remain provisional until Core, Fleet, and Agent owners approve C01/C04.

## Review Focus

- Retry after an unknown create result retains the same operation and idempotency key; a changed actor or request conflicts.
- Invitation terminal states never disclose a reusable secret.
- `429` honors a valid `Retry-After`; absent/invalid values use bounded backoff without changing operation identity.
- A redeemed Fleet invitation is not treated as a Core binding until an explicit successful synchronization.
- Core/Fleet partial failure remains visible and can be retried by operation ID; audit contains no secret.
- Existing M1 legacy enrollment and retirement behavior stays green.

---

### Task 1: Fleet application ports and HTTPS adapter

**Files:** Add Fleet invitation and installation ports/errors under `src/modules/agent-management/application/fleet/`; add HTTPS adapter and mTLS configuration under `infrastructure/fleet/`; update env schema/tests and Agent Management DI.

**Interfaces:** Invitation port creates, reads, and cancels invitations by stable operation ID and carries verified actor audit context. Installation port queries installation/Node status, controls the owner/version enrollment gate, and revokes by stable operation ID. Both return typed, secret-bearing values only to the application call; terminal invitations are status-only.

- [x] Write adapter/config unit tests for HTTPS-only endpoint, required client certificate, safe status/error mapping, redirects, timeout, secret redaction, idempotency headers, and operation/request IDs.
- [x] Run focused tests and observe expected failure.
- [x] Implement minimal typed adapters and DI wiring, without changing public routes.
- [x] Run focused tests and lint. Typecheck has pre-existing Mongo driver API errors; it reports none in the new Fleet files.
- [x] Commit `feat(agent-management): add Fleet client boundary`.

### Task 2: Invitation request orchestration

**Files:** Add invitation operation persistence port/store, application use case, controller/DTO, module wiring, and local OpenAPI route only if a public route is added.

**Interfaces:** Controller performs verified-principal and `agent:manage` checks and passes actor, request ID, idempotency key, and Node ID to the use case. Use case verifies Node eligibility before Fleet; local journal binds idempotency key to actor + normalized request, never stores invitation secrets, and marks unresolved outcomes pending for same-operation retry.

- [x] Add use-case/controller coverage for Node-ineligible, operation replay/conflict, Fleet unknown outcome, pending state, and no secret persistence/logging. IAM guard remains the existing Nest route policy.
- [x] Implement invitation orchestration and secret-safe response (`Cache-Control: no-store`).
- [x] Run focused tests and existing M1 enrollment regressions.
- [x] Commit `ca940e8 feat(agent-management): add Fleet invitation and binding sync`.

### Task 3: Explicit Fleet enrollment synchronization and audit

**Files:** Add sync use case/controller path, local binding projection port/store support, operation journal states, Agent Management public binding-query wiring, and audit facts.

**Interfaces:** An authorized user-triggered sync queries Fleet by invitation/operation ID. Pending/terminal outcomes remain non-binding. Redeemed result must match Core's authorized Node/invitation; Core transaction creates/updates installation and binding plus secret-free audit exactly once. Persistence failure retains `SYNC_PENDING`; retry uses the same operation ID. Retirement checks Fleet live when local sync may be stale.

- [x] Add tests for pending then redeemed sync, persistence retry, idempotent binding/audit, mismatched remote Node, and live Fleet retirement guard.
- [x] Implement explicit sync and fail-closed status query; keep Core legacy enrollment intact.
- [x] Run focused tests and retirement/M1 regressions.
- [x] Sync is in `ca940e8 feat(agent-management): add Fleet invitation and binding sync`; Fleet-aware retirement guard is in `ef435f4 fix(asset-topology): guard retirement against Fleet bindings`.

### Task 4: Fake Fleet HTTP integration and CI regression gates

**Files:** Add a contract-shaped in-memory fake Fleet application-flow spec, update `.github/workflows/ci.yml` to run the fake-flow and M1 regression commands before coverage tests, and document FM-02/03 implementation/test/migration boundaries in `docs/local/architecture/fleet-manager-core-integration-design.md`.

- [x] Add an in-memory contract-shaped fake-Fleet application-flow spec for invitation → redemption → one Core binding/audit.
- [x] Add dedicated fake-flow and M1 regression steps to CI. The fake proves Core orchestration only; it does not prove real Fleet or Supervisor compatibility.
- [x] Run focused fake/Fleet and M1 tests, full coverage suite (132 suites / 640 tests), scoped ESLint, and changed-file format check.
- [x] Run repository-wide ESLint, typecheck, and build with local binaries. They report existing MongoDB/Express typing diagnostics outside Fleet application/controller code; full ESLint also reports repository-wide unsafe Mongo usage. All changed application/controller/client files pass scoped lint and all changed files pass Prettier.
- [ ] Commit CI verification gates and final design/plan status.

## Review and rollout gates

- Do not claim production Core–Fleet–Supervisor interoperability without an authenticated staging run against Fleet and the pinned official Supervisor v0.160.0. The Core repository does not own that binary/runtime.
- Before production: approve C01/C04 wire/auth/idempotency/gate/revoke/sync semantics, add operational pending-operation visibility and retry runbook, and separately design legacy installation migration/cutover and rollback.

# IAM-005 User Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver IAM user directory, profile, role/grant, status, credential reset, and session revocation capabilities with transactional audit and concurrency safety.

**Architecture:** Keep user administration in the IAM module. Presentation uses the existing IAM authorization decorators, HTTP envelopes, and OpenAPI contracts. Application commands coordinate IAM-owned ports, `UnitOfWorkPort`, and Outbox facts; MongoDB adapters implement atomic CAS updates and the active-admin invariant. Permission-set mutations emit one Audit Fact v2 containing complete permission arrays, while scalar-only mutations remain v1-compatible.

**Tech Stack:** NestJS, TypeScript, Zod, Mongoose/MongoDB transactions, Platform Events, Jest.

**Spec:** `docs/local/specs/spec-002--epic-iam-module.md`, IAM-005 issue #21, and `api/v1/iam.yaml`.

## Global Constraints

- Follow root `AGENTS.md`, Modular Clean Architecture, and IAM ownership boundaries.
- Use existing `UnitOfWorkPort`, Outbox writer, Audit Fact v1/v2 contracts, and host relay scheduling.
- Keep Audit Fact v1 immutable; use the implemented v2 contract for permission arrays.
- Never include passwords, tokens, hashes, or temporary credentials in audit facts or logs.
- Keep role/status/grant writes atomic; reject unknown permissions, self role/grant edits, self-disable, and last-active-admin removal.
- Preserve API response, strict validation, pagination, request ID, and Problem Details conventions.
- No Agent Management permissions, user hard deletion, new dependencies, or module-internal cross-imports.
- Retry complete transaction attempts up to three times after an OCC conflict; return stable `409 Conflict` after exhaustion.

## Review Focus

- Two concurrent admin changes must not remove the last active IT Admin.
- A stale per-user sequence must retry from fresh state and re-evaluate invariants.
- Permission arrays must be complete, unique, catalog-valid, and represented only in Audit Fact v2.
- No-op updates must not increment the audit sequence or append a misleading fact.
- Outbox failure must roll back account and session changes in the same transaction.

---

### Task 1: Add IAM user administration application capabilities

- [ ] Write service tests for profile updates, role replacement, additional-permission replacement, status changes, admin reset, and session revocation. Assert no-op behavior and self-edit protections.
- [ ] Implement the IAM application port and use cases with fresh state and invariant checks on each transaction attempt.
- [ ] Add bounded three-attempt OCC retry behavior and verify exhaustion maps to a stable conflict.
- [ ] Keep creation and self-service password change behavior compatible with existing IAM-002 flows.

### Task 2: Persist administrative state safely

- [ ] Extend IAM-owned MongoDB ports/adapters for public user queries, cursor listing, profile changes, CAS role/grant/status writes, password reset, and session revocation.
- [ ] Serialize active-admin removal operations with a transactional invariant guard so concurrent changes cannot both pass a stale count.
- [ ] Allocate each `iam.user` resource sequence with an atomic expected-sequence update in the same transaction.
- [ ] Verify transaction contexts reach every participating write and that failures roll back all changes.

### Task 3: Expose the administration HTTP contract

- [ ] Implement the user list/detail/profile, role, permission-set, status, password-reset, session-revocation, and role/permission catalog routes already defined in OpenAPI.
- [ ] Apply `user:read`, `user:manage`, and `user:grant` route policies; strictly validate request bodies and cursor parameters.
- [ ] Keep credential-bearing responses no-store and never expose credential/session internals.
- [ ] Add controller tests for response shapes, validation, permission metadata, conflicts, and not-found behavior.

### Task 4: Record committed changes as versioned Audit facts

- [ ] Emit scalar-only Audit Fact v1 for profile, status, credential-reset, and session-revocation mutations where applicable.
- [ ] Emit exactly one Audit Fact v2 for a permission-set mutation, including role changes that clear grants, with complete before/after arrays and related scalar changes.
- [ ] Do not append facts for no-ops; prove Outbox failure rolls back business and session changes.
- [ ] Update IAM behavior documentation and reconcile SPEC-002's superseded v1-only permission-array guidance with the accepted v2 decision.

### Task 5: Verify composed and concurrent behavior

- [ ] Add replica-set integration tests for concurrent last-admin removal, same-user OCC retries, sequence uniqueness, and transaction rollback.
- [ ] Verify each route against the existing OpenAPI contract and platform HTTP response/error behavior.
- [ ] Run focused IAM tests, relevant integration/e2e tests where MongoDB is available, typecheck, build, ESLint, formatting checks, and `git diff --check`.
- [ ] Review the complete diff for boundary violations and unintended changes before marking IAM-005 complete.

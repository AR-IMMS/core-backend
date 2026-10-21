# IAM-001 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver IAM's fixed human role and permission model, domain invariants, effective permission resolution, and an intentional public application boundary.

**Architecture:** Keep role, user access state, and permission rules in framework-independent IAM domain code. Preserve the implemented permission catalog API, expose only IAM-owned application contracts from the module entry point, and defer persistence/concurrency enforcement to IAM-002 and IAM-005.

**Tech Stack:** TypeScript, Jest, existing NestJS module composition (only for existing catalog integration); no new dependencies.

**Spec:** `docs/local/specs/spec-002--epic-iam-module.md`, especially §§4–6, 11.3, 14.1, 18; approved IAM-001 in `.scratch/ticket-drafts/iam-module/tickets.md`.

## Global Constraints

- Keep domain code independent of NestJS, MongoDB, and external frameworks.
- Preserve the implemented `PermissionCatalogPort` and fixed 19-entry catalog; add no Agent Management permission.
- Roles remain exactly `IT_ADMIN`, `OPERATOR`, and `TECHNICIAN`; role permissions are fixed in code.
- User status uses `ACTIVE`/`INACTIVE` to match the existing IAM OpenAPI contract; SPEC-002 §7.1 reflects the user's decision.
- Effective permissions are the union of a role baseline and valid, unique, additional permissions; reject wildcard, unknown, baseline-duplicate, and restricted non-admin additions.
- Role changes clear additional permissions; last-active-admin state transitions are guarded by an explicit domain policy, with atomic persistence enforcement deferred to the mutation slice.
- Business modules use only the IAM public application contract; resource-specific policy remains with the owning module.
- Preserve unrelated user changes and do not publish, close, or otherwise update the GitHub issue until implementation is complete.

## Review Focus

- Unknown, wildcard, duplicate, and role-baseline-duplicate permissions are rejected.
- `user:manage` and `user:grant` cannot be added to non-admins.
- Inactive principals do not authorize even if a permission matches.
- Role replacement cannot preserve prior additional grants.
- Concurrent protection against removing the last active IT Admin is exposed as a domain precondition and documented for atomic enforcement by later persistence work.

---

### Task 1: Define fixed role permissions and effective-permission rules

**Files:**
- Create focused role/authorization domain source under `src/modules/iam/domain/`.
- Test the role matrix and permission resolver in a neighboring `*.spec.ts`.
- Preserve `src/modules/iam/domain/permission-catalog.ts` and its public port.

**Interfaces:**
- Consume `PermissionCode`/`isIamPermissionCode` from the existing catalog.
- Produce typed `RoleCode`, role validation, immutable role baseline lookup, and effective-permission resolution for later IAM domain/application code.

- [x] Write documented failing tests for each role's exact baseline, IT Admin's explicit complete catalog, union resolution, unknown and wildcard rejection, duplicates, baseline duplicates, and restricted additional IAM grants.
- [x] Run the focused Jest spec and confirm failures are due to the missing role model/resolver.
- [x] Implement the smallest framework-independent role catalog and resolver consistent with SPEC-002 §§4–6.
- [x] Run the focused Jest spec and confirm it passes.

### Task 2: Model user access invariants and authorization boundary

**Files:**
- Create focused user access/domain policy source under `src/modules/iam/domain/`.
- Add application-facing principal and permission-check contracts under `src/modules/iam/application/`.
- Update `src/modules/iam/index.ts` for intentional public exports.
- Add focused domain and contract tests.

**Interfaces:**
- Consume Task 1 role and permission types.
- Produce IAM-owned user access state with status, role, additional grants, effective permissions, role-change clearing, inactive-principal denial, and a last-active-admin transition precondition.
- Produce a framework/persistence-independent principal contract and all-of permission-check contract. Contracts expose only stable identity/status/role/effective-capability information, not domain persistence internals.

- [x] Write documented failing tests for role-change clearing, inactive-principal denial, last-active-admin demotion/disable rejection when it is the last active admin, and permission all-of semantics.
- [x] Run focused specs and confirm expected failures.
- [x] Implement domain transitions and stable public contracts without importing framework or persistence packages.
- [x] Run focused specs and confirm they pass.

### Task 3: Document the IAM foundation boundary

**Files:**
- Create or update `src/modules/iam/README.md` only if it fits current module documentation conventions; otherwise document the boundary in the existing approved IAM specification/ticket documentation without duplicating the full spec.

- [x] Document the provisional role/permission catalog, additive grant rules, last-active-admin atomic enforcement requirement, and separation from resource policies.
- [x] Run all IAM unit tests, typecheck/build, changed-file lint/format, full unit suite, and `git diff --check`.
- [x] Review the final diff to confirm only IAM-001-owned files changed and existing user modifications remain intact.
- [x] After verification, move issue #17 to Review / Verify and add a factual completion comment; leave the issue open for review.

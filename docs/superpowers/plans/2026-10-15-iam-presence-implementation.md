# IAM Presence and Session Authentication Implementation Plan

> **For agentic workers:** Execute inline using TDD. Steps use checkbox syntax for tracking.

**Goal:** Implement the approved session-derived IAM presence capability with authenticated session leases, self-service preferences, and a public lookup boundary for consuming modules.

**Architecture:** IAM owns account/session persistence, token/session validation, presence leases, preferences, effective status, and the public candidate-ID lookup contract. The HTTP boundary authenticates current session context before heartbeat or preference operations. Presence uses the existing user/session records and does not emit Audit facts. Ticket retains candidate selection and resource policy.

**Tech Stack:** NestJS 11, TypeScript 5.9, Mongoose 9, `@nestjs/jwt`, Argon2, Jest 30, Zod / `nestjs-zod`, existing platform HTTP and MongoDB modules.

**Spec:** `docs/superpowers/specs/2026-10-15-iam-user-presence-design.md`, `docs/local/specs/spec-002--epic-iam-module.md`, `api/v1/iam.yaml`

## Global Constraints

- Keep domain code independent of NestJS, MongoDB, HTTP, and JWT types.
- Other modules use only intentional IAM public application contracts; Ticket owns candidate selection, assignment, workload, and resource-specific rules.
- `UserStatus` remains `ACTIVE | INACTIVE`; presence status is `ONLINE | BUSY | AWAY | OFFLINE`; user preference is `AUTOMATIC | BUSY | AWAY`.
- A 30-second heartbeat interval and 90-second lease lifetime are configurable PoC defaults; expiry uses server time.
- A live lease must belong to an active, non-revoked session; an inactive account or absence of a live lease resolves to `OFFLINE`.
- Preference applies across devices; `AUTOMATIC` resolves to `ONLINE` with any live lease.
- Dashboard/native presence requests use Bearer access authentication; refresh cookies do not authenticate presence endpoints.
- Heartbeats, lease expiry, and preference changes emit no Audit fact and contain no secrets in logs or responses.
- Bootstrap initial credential comes from deployment secret configuration and is never logged; first login requires a password change.
- Preserve existing local/untracked user work; do not stage or discard unrelated changes.

## Review Focus

- Expired or revoked sessions cannot renew leases, including concurrent heartbeat attempts.
- Multiple sessions aggregate correctly; revoking one device must not force `OFFLINE` while another lease remains live.
- Server time, not client time, determines lease expiry.
- Inactive accounts resolve `OFFLINE` regardless of preference or stale session data.
- Authentication and preference routes cannot trust caller-supplied user/session IDs; only current verified principal/session context is used.

---

### Task 1: Model effective user presence

**Status:** Complete

**Files:**
- Create: `src/modules/iam/domain/user-presence.ts`
- Create: `src/modules/iam/domain/user-presence.spec.ts`
- Modify: `src/modules/iam/index.ts`

**Interfaces:**
- Produces `UserPresenceStatus`, `UserPresencePreference`, and pure `resolveUserPresence({ accountStatus, preference, hasLiveLease })`.

- [ ] Write unit tests for all preference mappings, inactive-account override, and absent-lease override; run and observe expected failures.
- [ ] Implement the minimal pure model and exports.
- [ ] Run the focused unit suite and confirm all expected cases pass.

### Task 2: Add IAM-owned user/session persistence for presence leases

**Status:** Implemented; replica-set verification remains

**Files:**
- Create/modify IAM-owned user and session schema/model adapters under `src/modules/iam/infrastructure/mongodb/`.
- Create persistence ports and tokens under `src/modules/iam/application/ports/`.
- Create focused Mongo adapter tests.

**Interfaces:**
- Consumes Task 1 types.
- Produces IAM operations to renew a lease only for an active valid session, persist the shared user preference, and query effective-presence inputs for a caller-provided set of user IDs.

- [ ] Test valid heartbeat renewal, refusal for revoked/expired sessions, preference persistence, bounded candidate queries, and server-time lease checks.
- [ ] Implement indexes and adapters using existing IAM-owned collections; avoid direct access from other modules.
- [ ] Run adapter tests; transaction-dependent cases use the existing replica-set integration setup.

### Task 3: Implement authenticated session lifecycle and bootstrap prerequisite

**Status:** Partial — bearer login/refresh/logout and principal revalidation exist; secure bootstrap, browser cookie flow, rate limits, and audited password change remain.

**Files:**
- Create IAM authentication/session application, domain, infrastructure, and presentation components following existing module conventions.
- Wire configuration and IAM providers through application composition.
- Add focused tests for bootstrap, login, token/session validation, refresh rotation, and logout.

**Interfaces:**
- Produces verified `HumanPrincipal` plus opaque server-validated session ID in request context for Task 4.
- Initial bootstrap reads the operator-controlled initial credential from deployment secret configuration and forces a password change on first login.

- [ ] Test bootstrap idempotency and existing-admin safe behavior; ensure secret values never enter logs or responses except the authorized first-use delivery flow.
- [ ] Test login, generic failure, access-token validation, refresh rotation single-winner/reuse revocation, and logout.
- [ ] Implement only configuration-driven keys/issuer/audience/TTLs/rate limits; do not add user signup or notification-provider reset.

### Task 4: Implement presence use cases, HTTP routes, and public lookup contract

**Status:** Implemented for Bearer-authenticated presence routes; composed HTTP verification is blocked by sandbox loopback restrictions.

**Files:**
- Create presence use cases and IAM public `UserPresencePort` in `src/modules/iam/application/`.
- Create authenticated IAM presence controller and validation schemas in `src/modules/iam/presentation/`.
- Wire module providers and update `src/modules/iam/index.ts`, `api/v1/iam.yaml`, and IAM README.

**Interfaces:**
- `UserPresencePort.getPresence(candidateUserIds)` returns effective statuses for only the supplied IDs; missing users return `OFFLINE`.
- Heartbeat derives user/session only from verified request context; preference update targets only that principal.

- [ ] Test `POST /api/v1/auth/me/presence/heartbeat` returns 204, rejects unauthenticated/invalid sessions, and does not accept client timestamps.
- [ ] Test `PUT /api/v1/auth/me/presence-preference` accepts only AUTOMATIC/BUSY/AWAY and returns standard envelope; attempts to set ONLINE/OFFLINE or another user are rejected.
- [ ] Extend `GET /api/v1/auth/me` with effective presence and preference; test HTTP response and Problem Details conventions.
- [ ] Test public lookup requires bounded caller-selected candidate IDs and does not expose persistence types.
- [ ] Verify no presence operation emits Audit facts or logs secrets.

### Task 5: Verify composed presence and session behavior

**Status:** Partial — unit suites and build typecheck pass; HTTP/replica-set integration verification remains.

**Files:**
- Add focused IAM controller/application integration tests and replica-set E2E coverage in existing `test/` paths.
- Update IAM README and any relevant OpenAPI examples.

- [ ] Test multi-device aggregation, lease expiry, logout/revocation, inactive-account override, and all preference modes through composed application flows.
- [ ] Test the public candidate-ID lookup boundary and confirm no user enumeration behavior.
- [ ] Run focused Jest tests, typecheck/build, and E2E only when the required MongoDB replica-set services/configuration are available.

## Execution notes

- Existing checkout is `epic/iam-module` and contains unrelated/untracked IAM foundation, spec, contract, and ticket work. Execute in place to preserve those inputs; do not create a detached default-branch worktree that omits them.
- Ruling: The repository has no IAM user/session persistence or authentication guard. Implement the minimal IAM-003 prerequisite needed to secure and exercise presence rather than exposing unauthenticated heartbeat endpoints.
- Ruling: Use the approved deployment-secret bootstrap delivery choice and server-enforced first-login password change; no fixed source credential or secret logging.
- Implemented effective presence domain/preference, IAM-owned session leases and user preference persistence, candidate-ID-only lookup, Bearer principal resolution, Native JSON login/refresh/logout endpoints, Argon2 password hashing, RS256 JWT issue/verification, current-user/presence routes, and CoreModule/IamModule composition.
- Added regression coverage for Bearer parsing and first-use password-change service behavior. The Bearer parser originally rejected tokens containing the letter `s`; the regression failed before the parser was corrected.
- Current verification: focused IAM unit tests pass (12 suites / 50 tests); `tsc --noEmit -p tsconfig.build.json` passes. The controller integration test cannot connect to its local Supertest listener in this sandbox (`EACCES 127.0.0.1`). The transaction-required MongoDB replica-set tests were not run.
- Remaining acceptance gaps: browser Dashboard cookie login/refresh/logout and CSRF/Origin checks; configured login/refresh rate limits; a controlled non-HTTP initial-admin seed with deployment-secret delivery and safe already-exists behavior; atomic Audit Fact + account mutation transactions for bootstrap/password changes; and replica-set concurrency/refresh-rotation verification. The current OpenAPI contract describes browser flows and rate limits that are not yet wired in controllers.
- Audit v2 is already present and was not reimplemented in this work. Presence heartbeat/preference changes remain non-audited per the approved design.

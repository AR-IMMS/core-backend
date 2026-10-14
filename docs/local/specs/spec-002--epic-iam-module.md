# SPEC-002 — Human Identity and Access Management (IAM)

**Project:** AR-IMMS Core Backend  
**Status:** Proposed — for review  
**Version:** 0.1.0  
**Scope:** Human users of Dashboard, AR, and Mobile clients  
**Architecture:** NestJS modular monolith, Modular Clean Architecture  
**Related documents:** `docs/shared/PRODUCT.md`; business flows; `docs/local/adr/adr-001--platform-event-bus-for-core-modular-monolith.md`; `docs/local/specs/spec-001--platform-events.md`; platform HTTP conventions; Audit API contract  
**Implementation status:** Design only. No IAM implementation is assumed to exist.

## 1. Purpose

Provide secure, auditable authentication, user administration, and authorization for human users without introducing a generic policy engine or premature multi-tenant architecture. This specification defines a baseline that can be extended as business flows evolve.

Normative terms **MUST**, **SHOULD**, and **MAY** indicate requirement strength.

## 2. Scope

### 2.1 In scope

- Admin-provisioned human accounts; no public sign-up.
- Local username/email and password authentication.
- JWT access tokens, opaque rotating refresh tokens, and server-side sessions.
- Exactly one system-defined role per user.
- Fixed permission catalog and fixed role-to-permission mappings defined in code.
- Admin-managed additional user permissions (additive only).
- API authentication and permission checks, plus resource-specific business policies.
- User/session lifecycle and security-sensitive administrative operations.
- Durable Audit facts for meaningful committed IAM business changes.
- HTTP contracts conforming to the existing `/api/v1` response, validation, and error conventions.

### 2.2 Out of scope

- Telemetry Agent identity, bootstrap tokens, agent registration/unlink, and machine credentials.
- Custom roles, dynamic permission creation, direct permission denies, role hierarchy, multiple roles per user.
- SSO/OIDC federation, MFA, multi-tenancy, external IAM provider integration.
- A general ABAC/ReBAC/policy expression engine.
- Password self-service recovery via email (may be added later).
- Audit query API implementation (separate work).
- Ticket/Maintenance-specific authorization rules, except the integration contract.

### 2.3 Explicit deferral: Agent Management

No `agent:*` permission is approved by this specification. Agent Management MUST define operation-specific human permissions and resource policies in its own design before exposing protected endpoints. Until then, access MUST default to denied. This does not change the separate Agent authentication architecture.

## 3. Confirmed decisions and design principles

| Topic                  | Decision                                                       |
| ---------------------- | -------------------------------------------------------------- |
| Role cardinality       | Exactly one role per user                                      |
| Roles                  | `IT_ADMIN`, `OPERATOR`, `TECHNICIAN`, code-defined             |
| Role permissions       | Mandatory baseline, code-defined                               |
| Additional permissions | IT Admin can grant/revoke from fixed catalog; additive only    |
| Effective permissions  | Union of role permissions and additional permissions           |
| Denial                 | Deny by default; no explicit deny entries                      |
| Admin                  | All catalog permissions, but never bypasses domain invariants  |
| Persistence            | MongoDB; no `roles` or `permissions` collection for PoC        |
| Cross-module access    | Public application contracts, never another module's internals |
| Audit                  | `audit.fact` v1 through transactional outbox                   |
| Delivery               | Existing at-least-once relay; idempotent Audit consumer        |

Prefer a small set of stable business capabilities over one permission per HTTP route. Adding a permission requires a catalog update, role-matrix review, endpoint/use-case enforcement, tests, and documentation. No silent grants to existing roles.

## 4. Actors and authorization model

### 4.1 Roles

- **IT_ADMIN:** Account administration, security grants, system configuration, and all approved catalog permissions. Admin is still subject to workflow invariants and any explicit high-risk-operation safeguards.
- **OPERATOR:** Monitoring, incident investigation, ticket coordination/closure, maintenance planning and verification.
- **TECHNICIAN:** Read operational context and execute assigned field maintenance activities.

A role identifies a user's principal responsibility, not a bundle of arbitrary exceptions.

### 4.2 Permission resolution

`EffectivePermissions(user) = RolePermissions[user.role] ∪ user.additionalPermissions`

Rules:

1. The role MUST be a valid `RoleCode`.
2. Additional permissions MUST be valid catalog entries, unique, and not duplicated from the current role baseline.
3. Only an authorized administrator may modify another user's role or additional permissions.
4. A change of role MUST clear additional permissions atomically in the baseline implementation; the administrator can explicitly re-grant justified exceptions afterward.
5. Privilege-granting IAM permissions (`user:grant`, `user:manage`) MUST NOT be available as additional permissions to non-admin users in the PoC. This is an explicit allowlist restriction, not a new deny engine.
6. User status and session validity MUST be checked independently of permissions.
7. A valid permission does not imply access to every instance of a resource.

### 4.3 Authorization layers

1. **Authentication:** Identify the active human principal and valid session.
2. **Capability check:** Check required permission(s) against current effective permissions.
3. **Resource/business policy:** The owning module checks assignment, ownership, workflow state, and domain invariants.
4. **Mutation and audit:** Apply the authorized state transition and persist its audit fact atomically.

Examples: `maintenance:execute` does not allow execution of an unassigned activity; `ticket:close` does not override ticket ownership or closure preconditions.

### 4.4 Permission semantics

A single required permission means membership. Where an endpoint requires several independent capabilities, checks MUST use **all-of** semantics unless an explicit, documented business policy provides alternatives. No wildcard (`*`) permission is used in the catalog. `IT_ADMIN` receives the explicit complete catalog at resolution time.

## 5. Initial permission catalog

This catalog is provisional and version-controlled. It contains **19** permissions and intentionally excludes Agent Management.

| Domain      | Permission             | Capability                                                     |
| ----------- | ---------------------- | -------------------------------------------------------------- |
| IAM         | `user:read`            | View user directory and administrative user details            |
| IAM         | `user:manage`          | Create/update/disable/enable users and admin-reset credentials |
| IAM         | `user:grant`           | Assign role and manage additional permissions                  |
| Asset       | `asset:read`           | View asset hierarchy/topology                                  |
| Asset       | `asset:manage`         | Create/update/remove assets and mappings                       |
| Monitoring  | `monitoring:read`      | View monitoring status, metrics and alerts                     |
| Monitoring  | `monitoring:manage`    | Manage monitoring configuration and alert rules                |
| Incident    | `incident:read`        | View incidents, episodes and evidence                          |
| Incident    | `incident:investigate` | Record investigation and request AI investigation              |
| Incident    | `incident:manage`      | Manage incident decisions and lifecycle                        |
| Ticket      | `ticket:read`          | View tickets and processing history                            |
| Ticket      | `ticket:create`        | Create a ticket                                                |
| Ticket      | `ticket:manage`        | Classify, update and assign tickets                            |
| Ticket      | `ticket:close`         | Conclude and close tickets, subject to owner policy            |
| Maintenance | `maintenance:read`     | View maintenance activities and checklists                     |
| Maintenance | `maintenance:manage`   | Plan/create/assign activities                                  |
| Maintenance | `maintenance:execute`  | Perform and record field maintenance                           |
| Maintenance | `maintenance:verify`   | Verify maintenance results                                     |
| Audit       | `audit:read`           | Read audit records through protected query APIs                |

Permission names describe business capabilities, not controller methods. Splitting a permission later requires a concrete least-privilege reason.

## 6. Default role-permission matrix

`Y` = included in role baseline. `–` = not included; non-sensitive catalog permissions may be granted individually by Admin.

| Permission             | IT_ADMIN | OPERATOR | TECHNICIAN |
| ---------------------- | :------: | :------: | :--------: |
| `user:read`            |    Y     |    –     |     –      |
| `user:manage`          |    Y     |    –     |     –      |
| `user:grant`           |    Y     |    –     |     –      |
| `asset:read`           |    Y     |    Y     |     Y      |
| `asset:manage`         |    Y     |    –     |     –      |
| `monitoring:read`      |    Y     |    Y     |     Y      |
| `monitoring:manage`    |    Y     |    –     |     –      |
| `incident:read`        |    Y     |    Y     |     –      |
| `incident:investigate` |    Y     |    Y     |     –      |
| `incident:manage`      |    Y     |    Y     |     –      |
| `ticket:read`          |    Y     |    Y     |     Y      |
| `ticket:create`        |    Y     |    Y     |     –      |
| `ticket:manage`        |    Y     |    Y     |     –      |
| `ticket:close`         |    Y     |    Y     |     –      |
| `maintenance:read`     |    Y     |    Y     |     Y      |
| `maintenance:manage`   |    Y     |    Y     |     –      |
| `maintenance:execute`  |    Y     |    –     |     Y      |
| `maintenance:verify`   |    Y     |    Y     |     –      |
| `audit:read`           |    Y     |    –     |     –      |

The matrix is a starting point, not a declaration that all listed business operations are already implemented. Each module must verify the capability before exposing a new action. Admin's `maintenance:execute` capability does not automatically satisfy assignee requirements.

## 7. Domain model and invariants

### 7.1 User

Recommended fields:

- `id`, `username`, `email`, `displayName?`
- `role: RoleCode`
- `additionalPermissions: PermissionCode[]`
- `status: ACTIVE | DISABLED`
- `version` (for optimistic concurrency / event sequence, subject to existing outbox rules)
- `createdAt`, `updatedAt`

Invariants:

- Username/email normalized consistently and uniquely indexed; document the case-insensitive normalization strategy.
- Valid role; valid and deduplicated additional permissions.
- No self-service privilege escalation.
- A disabled user cannot authenticate or authorize requests.
- The last active IT Admin cannot be disabled or demoted. Enforce atomically or with a concurrency-safe administrative operation.
- User records are not hard-deleted in PoC; disabling preserves business attribution and audit history.
- Changing a role clears additional permissions in the same transaction.
- Privilege changes take effect for subsequent authorization checks, not merely at access-token expiry.

### 7.2 Credential

- `userId` (unique), `passwordHash`, `mustChangePassword`, `passwordChangedAt`, optional `credentialVersion`.
- Argon2id preferred; never store or emit plaintext passwords or password hashes.
- Admin provisioning MUST use a secure first-use credential process; if temporary passwords are used, require change on first authenticated use.
- Password reset revokes existing sessions, and the user must establish a new credential before normal access.
- First-login password-change restriction MUST be enforced server-side, not only by UI.

### 7.3 Session

- `id`, `userId`, `refreshTokenHash`, `createdAt`, `expiresAt`, `lastUsedAt?`, `revokedAt?`, optional `revokeReason`.
- Unique session ID; expiry index for cleanup; indexes on user/session lookups.
- One session per login/device, not one session globally per user.
- Refresh tokens are high-entropy opaque secrets; persist hashes only.
- Rotation MUST be atomic; concurrent reuse of the same refresh token cannot produce two successful rotations.
- Reuse handling SHOULD revoke the affected session/token family and emit a sanitized security log; exact false-positive/grace policy is deferred to implementation review.
- Session revocation, user disable, and credential reset invalidate future requests.

### 7.4 Persistence ownership

IAM owns its MongoDB schemas and repository adapters. Other modules MUST NOT read IAM collections directly. Domain entities MUST NOT depend on Mongoose, NestJS, HTTP, or JWT types.

## 8. Authentication design

### 8.1 Login

1. Validate request schema.
2. Find account by normalized username/email.
3. Verify password with a timing-safe password verifier and generic invalid-credentials response.
4. Reject disabled accounts.
5. Establish a session and issue short-lived JWT access token plus rotating opaque refresh token.
6. Enforce first-password-change restriction where applicable.

### 8.2 Token contract

Access JWT claims: `sub` (user ID), `sid` (session ID), `iat`, `exp`, `jti`, and standard issuer/audience as configured. Do **not** embed effective permissions as authoritative claims.

Initial configuration suggestions (not contractual constants): access token 10–15 minutes; refresh session absolute lifetime approximately 7 days. All TTLs MUST be configurable and tested.

Use asymmetric JWT signing if deployment/key-management permits; otherwise a strong secret with explicit algorithm allowlisting and rotation planning. Verify issuer, audience, signature algorithm, expiry, and session binding.

### 8.3 Client token handling

Prefer Secure, HttpOnly, appropriately scoped cookies for refresh tokens in supported web deployments; account for CSRF protection and cross-origin constraints. For AR/Mobile/WebView clients, select storage/transport based on actual client runtime; do not assume browser cookies or use `localStorage` as a blanket default. Never log tokens.

### 8.4 Refresh and logout

Refresh verifies the current session and refresh-token hash, atomically rotates the token, and issues a new access token. Logout revokes the current session. A user may have multiple active sessions; admin actions may revoke all sessions of a target user.

### 8.5 Live authorization

Authenticated requests MUST validate the active user and non-revoked session. Resolve current permissions from IAM state (MongoDB initially; no cache required). Permission changes are effective on the next authorization check. A permission check MUST NOT trust a stale role/permission claim in JWT.

### 8.6 Brute-force controls

Login and refresh endpoints MUST have practical rate limiting and generic authentication failures. Account enumeration via error messages is prohibited. Thresholds are configurable; detailed lockout strategy may be deferred.

## 9. User administration and business rules

- **Create user:** IT Admin supplies account identity and role; system creates credentials securely; audit creation. The initial admin is provisioned via a controlled bootstrap command, not a public route.
- **Update user:** Allowlisted profile fields only; role, status and additional permissions are not writable via generic profile update.
- **Change role:** Requires `user:grant`; clears additional permissions; audits old/new role and the cleared permissions without violating scalar-only audit change rules.
- **Set additional permissions:** Requires `user:grant`; accepts the full desired set, validates catalog and restricted grants, removes role-baseline duplicates, and computes grants/revocations for audit.
- **Disable user:** Requires `user:manage`; reject self-disable and last-active-admin disable; revoke sessions and audit in a consistent operation.
- **Enable user:** Requires `user:manage`; audit state transition; enabling does not restore revoked sessions.
- **Admin password reset:** Requires `user:manage`; invalidate sessions and record a sanitized audit fact without password/hash values.
- **Self-service change password:** Authenticated user with valid current password (or first-use/reset flow); revoke other sessions as appropriate; audit without secret values.
- **Self-modification:** An administrator MUST NOT change their own role or additional permissions through admin endpoints. Profile/password changes follow separate policies.
- **Idempotent no-op:** Unchanged state SHOULD avoid emitting a misleading `*_changed` audit fact; API behavior must be consistent.

Concurrency for last-admin protection and permission updates MUST be covered by integration tests.

## 10. HTTP API contract proposal

All routes below are **proposed**, not implemented or present in current OpenAPI. Prefix is `/api/v1`; health endpoints remain excluded as today. Apply the existing JSON response envelope (`data`, `meta.request_id`, optional `pagination`) and `application/problem+json` error conventions.

| Method | Route                                     | Access             | Purpose                                   |
| ------ | ----------------------------------------- | ------------------ | ----------------------------------------- |
| POST   | `/auth/login`                             | Public             | Authenticate; create session              |
| POST   | `/auth/refresh`                           | Refresh credential | Rotate token                              |
| POST   | `/auth/logout`                            | Authenticated      | Revoke current session                    |
| GET    | `/auth/me`                                | Authenticated      | Current profile and effective permissions |
| POST   | `/auth/change-password`                   | Authenticated      | Change own password                       |
| POST   | `/users`                                  | `user:manage`      | Create user                               |
| GET    | `/users`                                  | `user:read`        | List users with shared cursor pagination  |
| GET    | `/users/{user_id}`                        | `user:read`        | Read user                                 |
| PATCH  | `/users/{user_id}`                        | `user:manage`      | Update allowlisted profile fields         |
| PUT    | `/users/{user_id}/role`                   | `user:grant`       | Replace role; clear extras                |
| PUT    | `/users/{user_id}/additional-permissions` | `user:grant`       | Replace additional permission set         |
| PUT    | `/users/{user_id}/status`                 | `user:manage`      | Enable/disable                            |
| POST   | `/users/{user_id}/reset-password`         | `user:manage`      | Initiate admin reset                      |
| POST   | `/users/{user_id}/revoke-sessions`        | `user:manage`      | Revoke target sessions                    |
| GET    | `/iam/roles`                              | `user:read`        | Read fixed role catalog                   |
| GET    | `/iam/permissions`                        | `user:read`        | Read fixed permission catalog             |

### 10.1 Contract conventions

- Strict Zod request validation; reject unknown fields and malformed inputs.
- Public DTOs MUST never expose password hashes, refresh hashes, or internal session secrets.
- Use `401` for missing/invalid authentication, `403` for insufficient permission, `404` for absent resources, `409` for uniqueness or concurrency conflicts, and `400`/`422` according to the established validation contract.
- Use stable Problem Details error codes and the existing global exception filter; do not introduce IAM-specific response wrappers.
- `GET /auth/me` returns the current role and effective permissions for UI capability gating; UI gating is not server authorization.
- Login/refresh token response transport MUST be finalized with client cookie strategy before freezing OpenAPI.
- No generic public endpoint for submitting audit records or business facts.

### 10.2 Example payloads (illustrative)

`PUT /users/{user_id}/role`:

```json
{ "role": "OPERATOR" }
```

`PUT /users/{user_id}/additional-permissions`:

```json
{ "permissions": ["incident:read", "maintenance:verify"] }
```

`PUT /users/{user_id}/status`:

```json
{ "status": "INACTIVE" }
```

The server MUST reject `user:grant`/`user:manage` additions for non-admin roles and SHOULD reject any role-baseline duplicates in the submitted additional list (or normalize consistently and document it).

## 11. NestJS integration and public contracts

### 11.1 Guard sequence

1. Public-route metadata or route-specific auth flow.
2. Authentication guard validates token, user status, and session.
3. Permission guard resolves current effective permissions.
4. Application use case enforces business resource policy and invariants.

Protected-by-default policy is recommended: every non-public IAM route requires authentication. Audit `GET /audit/events` and `GET /audit/events/{event_id}` require `audit:read` when their controllers are implemented.

### 11.2 Permission decorator

Use a small typed decorator such as `@RequirePermissions('ticket:close')`, backed by a permission guard. No role-specific decorators are needed for business modules. Route-level checks are coarse capability gates, not substitutes for application-level resource policy.

### 11.3 Public IAM application contract

Expose only a small, typed application-facing port (illustrative):

```ts
interface HumanAccessPort {
  getPrincipal(userId: string): Promise<HumanPrincipal | null>;
  hasAllPermissions(
    userId: string,
    required: readonly PermissionCode[],
  ): Promise<boolean>;
}
interface HumanPrincipal {
  userId: string;
  role: RoleCode;
  status: 'ACTIVE' | 'INACTIVE';
}
```

Authentication middleware may use an IAM-owned session-validation contract. Business modules receive `ActorContext` (`userId`, request/trace correlation) via a supported boundary and MUST NOT import IAM Mongoose schemas or repositories.

**Dependency rule:** Place the contract in IAM's public API and export it via `IamModule`; do not place IAM business contracts in `src/shared` or `src/platform` merely for convenience. If a dependency cycle arises, revise the application composition/contracts rather than accessing internal implementations.

### 11.4 Suggested directory layout (Just for reference, you dont need to follow exactly)

```text
src/modules/iam/
├── iam.module.ts
├── index.ts                     # public exports only
├── domain/
│   ├── user.ts
│   ├── credential.ts
│   ├── session.ts
│   ├── roles.ts
│   ├── permissions.ts
│   └── role-permissions.ts
├── application/
│   ├── ports/
│   │   ├── user-repository.port.ts
│   │   ├── credential-repository.port.ts
│   │   ├── session-repository.port.ts
│   │   ├── password-hasher.port.ts
│   │   └── token-service.port.ts
│   ├── auth/                    # login, refresh, logout, password
│   ├── users/                   # provisioning, admin commands, queries
│   └── authorization/           # permission resolver/public service
├── presentation/
│   ├── auth.controller.ts
│   ├── users.controller.ts
│   ├── iam-catalog.controller.ts
│   ├── guards/
│   └── dto/
└── infrastructure/
    ├── mongodb/
    ├── crypto/
    └── jwt/
```

This is a target layout, not a requirement to create empty files/directories. Keep tests near their subjects, following repository conventions.

## 12. Audit and platform event integration

### 12.1 Existing infrastructure contract

Use `src/platform/events`'s existing `UnitOfWorkPort`, Outbox writer, versioned Business Fact envelope, relay, and consumer registry. The Audit consumer currently subscribes to `audit.fact` version 1 and appends idempotently by `event_id`. There is no broker topic or public event-ingestion route.

**Business mutation and its Audit fact MUST be persisted in the same MongoDB transaction.** The relay runs independently under a host scheduler/worker and may deliver at least once. Do not claim synchronous audit-query visibility when the command returns.

### 12.2 Producer responsibilities

IAM application use cases MUST:

1. Obtain trusted actor identity from authenticated context (or explicit trusted bootstrap/system identity).
2. Apply validated domain transition.
3. Construct a valid `audit.fact` v1 with `event_id`, `event_type`, `event_version`, `producer`, `occurred_at`, resource identity/sequence, approved `payload`, and request/trace context.
4. Persist IAM state and outbox fact via the same `UnitOfWorkPort` context.
5. Keep MongoDB sessions and driver-specific types inside infrastructure.
6. Use allowlisted, scalar-only changes; no full snapshots, nested values, password data, tokens, credential hashes, or secrets.

### 12.3 Audit action names

| IAM transition                | Action                        |
| ----------------------------- | ----------------------------- |
| User created                  | `iam.user.created`            |
| User profile changed          | `iam.user.updated`            |
| User enabled/disabled         | `iam.user.status_changed`     |
| Role replaced                 | `iam.user.role_changed`       |
| Additional permission granted | `iam.user.permission_granted` |
| Additional permission revoked | `iam.user.permission_revoked` |
| Admin credential reset        | `iam.credential.reset`        |
| Password changed              | `iam.credential.changed`      |
| Admin session revocation      | `iam.session.revoked`         |

For multiple permission changes, prefer a single business command with one or more valid facts according to existing resource-sequence semantics. Because Audit `changes[]` supports only allowlisted scalar values, do **not** serialize permission arrays into a scalar string or use unapproved nested payloads. A valid approach is one fact per changed permission with a scalar `permission` change **only if** the current parser allows that field and action representation; otherwise extend the versioned contract deliberately before implementation. This is a **contract review gate**, not permission to bypass validation.

Security telemetry such as failed login attempts SHOULD use sanitized security logging/rate-limit metrics rather than pretending every failed login is a committed business mutation.

### 12.4 Ordering and concurrency

Event resource sequences MUST increase per resource and remain unique under concurrent mutations. Reuse a version/optimistic-concurrency strategy only after confirming its compatibility with existing event sequencing and MongoDB transaction behavior. At-least-once delivery means consumers must remain idempotent; the existing Audit `appendIfAbsent(event_id)` behavior is the baseline.

### 12.5 Audit query compatibility

The known Audit HTTP gaps (version naming, `recorded_at`, omitted change values, actor enum, `context.source`) are tracked separately and do not block writing conforming `audit.fact` v1 events. They MUST be reconciled before the Audit read endpoints are implemented.

## 13. Security controls and threat cases

| Threat or failure                  | Required mitigation                                                        |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Privilege escalation via self-edit | Separate admin grant route; block self role/permission modification        |
| Excessive additional permissions   | Fixed catalog; restricted IAM grants; audit every change                   |
| Disabled user retains access       | Check current status and session on every protected request                |
| Revoked refresh token reuse        | Atomic rotation; reuse detection and session revocation                    |
| Concurrent refresh                 | Single-winner compare-and-swap                                             |
| Brute-force login                  | Rate limiting; generic errors; safe logs                                   |
| User enumeration                   | Generic invalid-login errors; no secret details                            |
| Stale JWT role claims              | Do not trust permission claims; resolve current permissions                |
| Last-admin lockout                 | Concurrency-safe last-admin invariant                                      |
| Untrusted request ID               | Validate/replace via existing request-context pipeline                     |
| Audit tampering/loss               | No public write API; transactional outbox; append-only idempotent consumer |
| Secrets in audit/logs              | Allowlist scalar changes; redact tokens/passwords/hashes                   |
| Unassigned field work              | Business module checks assignment/ownership and workflow state             |

### 13.1 Operational prerequisites

JWT keys/secrets, password hashing configuration, refresh lifetimes, rate limits, and initial-admin bootstrap must be environment-configurable, validated at startup, and excluded from source control. Deployment of transactional outbox requires MongoDB transaction support (replica set or compatible environment).

## 14. Testing and acceptance criteria

### 14.1 Domain/unit tests

- Every role resolves to its expected fixed permission set.
- Additional permissions union correctly; duplicates and unknown values are rejected.
- Role changes clear additional permissions.
- Non-admins cannot receive restricted IAM administrative grants.
- Disabled users cannot authorize.
- Last active admin cannot be disabled/demoted.
- Resource policy is independent from permission presence.

### 14.2 Authentication/integration tests

- Valid login, invalid password, disabled account, forced first-password change.
- Valid/expired/invalid JWT, revoked session, wrong issuer/audience.
- Refresh rotation succeeds once; two simultaneous refreshes have exactly one winner.
- Reused refresh token triggers documented handling.
- Logout and admin session revocation invalidate future access.
- Password reset invalidates sessions.
- Login rate limiting and sanitized error output.

### 14.3 HTTP contract tests

- Success envelopes and `meta.request_id` match platform conventions.
- Problem Details response status/code/format match existing filter.
- Missing authentication -> 401; missing permission -> 403.
- Strict Zod rejects unknown fields, invalid enum values and malformed requests.
- User APIs do not leak password hashes or refresh secrets.
- Audit query routes, when added, require `audit:read`.

### 14.4 Audit/integration tests

- Each meaningful IAM mutation commits business state and valid outbox fact atomically.
- A forced outbox write failure rolls back business mutation.
- Audit consumer appends once on duplicate delivery.
- Sensitive values never appear in fact payloads.
- Event sequence remains valid under concurrent updates.
- Relay scheduling is provided by the host; IAM does not start a duplicate relay.
- Audit records are eventually queryable after relay/consumer completion (once Audit queries exist).

### 14.5 Definition of done

A slice is complete only when: behavior is implemented within the owning module; unit/integration tests pass; relevant OpenAPI contracts and docs are updated; audit requirements are satisfied for committed business changes; no unrelated code changes; and the PR is small enough to review.

## 15. Implementation slices and dependencies

| Slice                                  | Deliverables                                                                            | Dependencies / review gate                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 — Domain and catalog                 | User model, role/permission catalog, resolver, invariants, unit tests                   | No platform changes                                                |
| 2 — Persistence and bootstrap          | User/Credential/Session repositories, indexes, controlled initial-admin bootstrap       | Verify DB conventions and transaction support                      |
| 3 — Authentication                     | Password service, login, JWT, refresh rotation, logout, session checks                  | Token transport decision for Web/AR/Mobile                         |
| 4 — Admin commands and Audit           | User administration, role/additional permission changes, audit facts/outbox integration | Verify Audit fact allowlist and resource sequencing                |
| 5 — Authorization and HTTP integration | Guards, decorators, public IAM port, OpenAPI and e2e tests                              | Verify platform HTTP/DI conventions; Audit query wiring separately |

Slices are conceptual review units, not necessarily one PR each. Avoid broad refactoring of `platform`, `audit`, or unrelated business modules.

## 16. Repository verification checklist (required before coding)

1. Read root `README.md`, relevant `AGENTS.md`, existing specs/ADRs, and `src/platform/events/README.md`; inspect `git status` and current tests.
2. Verify exact `UnitOfWorkPort` and Outbox writer signatures, transaction semantics, and resource sequence allocation.
3. Verify `audit.fact` v1 parser: action names, change-field allowlist, whether empty `changes` is legal, scalar constraints, and actor types.
4. Verify `CoreModule` composition and existing provider token/export conventions.
5. Verify global HTTP prefix, validation pipe, interceptor, request context, and Problem Details filter behavior.
6. Verify MongoDB module setup, indexes, session lifecycle, and transaction-enabled test environment.
7. Verify the location/versioning of OpenAPI source files under `api/`.
8. Check existing Audit query contract discrepancies before implementing Audit read controllers.
9. Check that no preexisting IAM code/contracts supersede this proposal.
10. Run focused tests and report what was and was not executed.

## 17. Open review decisions

These do not invalidate the baseline but must be resolved at the indicated implementation gate:

1. **Initial admin bootstrap:** secure one-time CLI/seed workflow and credential delivery.
2. **Client refresh-token transport:** cookie strategy for Dashboard versus AR/Mobile/WebView.
3. **Audit permission-change encoding:** represent multiple grant/revoke changes without violating scalar-only allowlist.
4. **Event resource sequence:** exact allocation mechanism under concurrent User mutations.
5. **Token lifetime, signing key management, and rate-limit thresholds:** environment defaults.
6. **Session reuse policy:** revoke scope and race handling.
7. **Credential reset experience:** admin-issued one-time reset or temporary-password workflow.
8. **Admin resource policy:** which business operations require explicit reassignment rather than direct Admin override.

All other details may evolve by a documented, reviewed contract change; no speculative framework is required.

## 18. Non-goals and change control

Do not add dynamic permission tables, generalized policy DSL, multi-role support, custom roles, IAM microservices, an event broker, or duplicate Audit persistence. Future changes should be additive where possible. Every new permission must specify: owning domain, business capability, default role grants, eligibility for additional grant, affected endpoints/use cases, resource policy, audit behavior, and tests.

**Acceptance of this specification does not imply the repository already implements the proposed endpoints or capabilities.**

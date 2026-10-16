# IAM HTTP Authorization Design

**Status:** Draft for review

**Issue:** IAM-004, [Integrate Authentication and Permission Checks Across HTTP](https://github.com/AR-IMMS/core-backend/issues/20)

**Source of truth:** SPEC-002 §11 and the IAM-004 acceptance criteria

## Goal

Protect HTTP routes by default with a verified human identity and explicit route policy. Give consuming modules a typed IAM-owned permission and principal boundary while keeping each business module responsible for its own resource-level rules.

## Current state

- IAM already verifies RS256 access tokens against the active user and server-side session. `HumanAccessGuard` attaches an `AuthenticatedHumanPrincipal`, including current effective permissions.
- IAM exports `HumanAccessPort`, but no adapter currently implements it. The active-session access port and Mongo adapter are IAM-owned internal contracts.
- IAM controllers bind `HumanAccessGuard` individually. There is no permission metadata decorator or permission guard.
- Audit has a local `AuditReadGuard` that checks `request.user.permissions`; IAM attaches `effectivePermissions`, so the two contracts do not match.
- Health endpoints are intentionally public. Auth login and refresh routes are public flows; other routes should require authentication unless explicitly marked public.

## Design decisions

### Ordered global guards

Register two global guards from IAM, in this order:

1. **Human authentication guard:** check generic public-route metadata; if not public, verify the bearer access token, current active user, and non-revoked unexpired session. Attach the verified session principal to the request. Preserve the existing forced-first-password-change restriction.
2. **Human permission guard:** skip explicitly public routes. For protected routes, require either explicit authenticated-only metadata or one or more permission codes. Validate permission metadata against IAM's fixed catalog and require every listed permission from the principal's current `effectivePermissions`.

Missing protected-route policy metadata, an unknown permission code, or a permission that the principal lacks fails closed with 403. Missing, invalid, expired, or revoked authentication fails with 401. Permission checks use current IAM state loaded by the authentication guard; JWT permission claims are not used.

Nest executes global guards before controller and route guards, and preserves their binding order. Metadata lookup uses handler-first precedence over controller metadata, following `Reflector.getAllAndOverride` semantics.

### Route policy metadata

- `@PublicRoute()` is generic HTTP metadata owned and exported by `src/platform/http`. It permits unauthenticated access only for the annotated handler or controller.
- `@AuthenticatedOnly()` is IAM metadata for routes that need an active human session but no capability check.
- `@RequirePermissions(...codes)` is IAM metadata for a non-empty set of fixed `PermissionCode` values. Its semantics are all-of; no role-based decorator or wildcard permission is added.
- All three decorators write one generic route-policy metadata value owned by `platform/http`. This lets `Reflector.getAllAndOverride` apply handler policy over controller policy even when decorator kinds differ; the platform stores policy labels and strings but does not interpret IAM permission codes.
- A handler or controller may declare only one policy. Applying multiple policy decorators to the same target is a configuration error; a handler-level policy intentionally overrides a controller-level policy.
- A route with none of these policies is denied as a server-side policy error (403), even if a valid token is present. This makes the protected-by-default rule reviewable and prevents new routes from silently becoming auth-only.

Public routes in the current application are health readiness/liveness, native login/refresh, and browser login/refresh/logout. Browser logout remains public at the access-token layer because its handler independently validates the refresh cookie, CSRF proof, and Origin before revoking that session. Native logout, password change, current-user/presence routes, and all user administration routes are protected. Every route policy is reflected in OpenAPI.

### Principal context and IAM application contract

- Keep session verification and persistence ports private to IAM.
- Add a minimal `AuthenticatedHumanContext` for HTTP consumers: `userId`, `role`, `status`, and current `effectivePermissions`. Do not expose password state, username, email, presence internals, Mongo documents, or session-token material through this boundary.
- Add `@CurrentHumanPrincipal()` for typed handler access to that context. The existing internal request principal can continue to hold fields needed by IAM-owned authentication/password flows.
- Implement and export the existing IAM-owned `HumanAccessPort` through IAM application and infrastructure composition. `getPrincipal(userId)` returns the current IAM-owned principal or `null` when missing. `hasAllPermissions(userId, required)` returns false for missing/inactive users, empty requirement lists, or unknown permission codes; otherwise it checks all requested codes against current effective permissions.
- Export only the public contract, decorators, and types through `src/modules/iam/index.ts`. Consuming modules must not import IAM repositories, domain user models, session stores, or presentation internals.

### Module integration and policy ownership

- Replace Audit's private `AuditReadGuard` with IAM's public `@RequirePermissions('audit:read')` metadata on its read controller. Audit continues to own its read use cases and stores.
- Annotate IAM auth, current-user, and user-administration routes with explicit public, authenticated-only, or permission policies. Remove duplicate controller-level authentication guards once the ordered global guards are active.
- Keep checks such as Ticket assignment eligibility, ownership, workflow state, and record-level rules in the owning business module. IAM provides only identity and coarse capability checks.
- Do not add `agent:*` permission codes or Agent Management authorization.

## HTTP and OpenAPI behavior

401 and 403 continue through the existing platform HTTP error and Problem Details handling. The guards do not write success envelopes or bypass global validation/interceptors. Update `api/v1/iam.yaml` and `api/v1/audit.yaml` with public/security declarations and `x-required-permissions` matching the implementation; preserve existing response schemas.

## Verification expectations

- Unit tests cover public metadata, missing/malformed/expired/revoked bearer tokens, active-user/session reload, forced password change, missing route policy, duplicate policy declarations, unknown permissions, all-of checks, and handler-over-controller precedence across policy kinds.
- HTTP integration tests verify public health/auth entry routes, authenticated current-user/password routes, Audit 401/403/200 behavior, and the standard response/error format.
- A consuming-module example proves Audit uses IAM's exported authorization decorator/contract and imports no IAM internals.
- Static checks and focused tests cover module provider wiring and the public export surface. No test may rely on stale JWT permission claims.

## Out of scope

- Login, refresh rotation, logout lifecycle, and cookie transport behavior delivered by IAM-003.
- User administration commands and their audits delivered by IAM-005.
- Ticket/Maintenance resource policies, Audit query behavior, Agent authorization, or new permission codes.
- Global HTTP throttling or other cross-cutting security controls unrelated to IAM authorization.

## Review checklist

- Authentication runs before permission checks for every protected route.
- Every route policy is explicit; absent or invalid policy cannot permit access.
- Public-route metadata remains an HTTP-platform concern and introduces no dependency from `platform` to IAM.
- Request context is narrow and contains no credential or unnecessary personal data.
- Authorization uses current effective permissions and leaves resource policy in its owning module.

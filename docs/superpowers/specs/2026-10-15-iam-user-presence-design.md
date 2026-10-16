# IAM User Presence Design

**Status:** Approved on 2026-10-15.

## Goal

Provide a current, coarse availability signal for future ticket distribution without conflating user availability with account activation or moving Ticket assignment policy into IAM.

## Domain model

`UserStatus` remains the account lifecycle state `ACTIVE | INACTIVE`. `UserPresenceStatus` is a separate effective availability value:

```text
ONLINE | BUSY | AWAY | OFFLINE
```

The effective presence is derived in this order:

1. If the account is not `ACTIVE`, the user is `OFFLINE`.
2. If no non-revoked, unexpired session has a live presence lease, the user is `OFFLINE`.
3. With at least one live session lease, the user's preference determines presence: `BUSY` or `AWAY` is returned as selected; `AUTOMATIC` resolves to `ONLINE`.

The user-level preference is `AUTOMATIC | BUSY | AWAY` and applies across all of that user's devices. Users cannot manually select effective `ONLINE` or `OFFLINE`; those values follow session state. The preference defaults to `AUTOMATIC` for new users and is retained while the user is offline. An `INACTIVE` account remains unable to authenticate or authorize even if any stale presence data exists.

## Session leases

Each authenticated device session owns its own presence lease. A client renews its lease through an authenticated heartbeat; the server derives expiry using server time and does not accept a client-supplied timestamp. A lease is live until its configured expiry. `OFFLINE` is returned only when every device lease is expired, revoked, or otherwise invalid.

Initial configurable PoC values are a 30-second heartbeat interval and a 90-second lease lifetime. The heartbeat endpoint is idempotent for the active session and cannot renew a revoked, expired, or invalid session. Logout or administrative revocation immediately removes that session from the live-presence calculation; another active device session can keep the user online.

## HTTP contract

The Dashboard, AR, Mobile, and WebView clients use their existing Bearer access-token contract for presence requests. Cookie-based refresh requests retain their existing CSRF and Origin requirements; presence requests do not authenticate with a refresh cookie.

Proposed routes and representation:

- `POST /api/v1/auth/me/presence/heartbeat` renews the current authenticated session's lease and returns `204 No Content`.
- `PUT /api/v1/auth/me/presence-preference` accepts `{ "preference": "AUTOMATIC" | "BUSY" | "AWAY" }` and returns the standard IAM success envelope containing the effective `presence_status` and saved preference.
- `GET /api/v1/auth/me` includes `presence_status` and `presence_preference` for the current user.

The OpenAPI contract defines `UserPresenceStatus` and `UserPresencePreference` separately. Existing account `UserStatus` remains unchanged. Presence responses follow `src/platform/http` response and Problem Details conventions. Heartbeat and preference endpoints require an authenticated, active user session; preference updates only affect the current user.

## IAM and Ticket ownership

IAM owns session lease renewal, preference storage, effective presence calculation, and the public read contract. Add an IAM-owned `UserPresencePort` that accepts caller-selected candidate user IDs and returns an effective presence value for each; missing, inactive, or expired users are represented as `OFFLINE`. It does not enumerate the user directory or expose IAM persistence types.

The Ticket module selects its candidate IDs and owns assignment eligibility, workload balancing, fairness, assignment transactions, and any checks that must be repeated when committing an assignment. Presence is only an input signal: `ONLINE` does not imply a permission, guarantee assignment, or override resource policy. IAM does not import Ticket internals or implement Ticket distribution.

## Persistence and audit

Persist the user's preference with IAM-owned user state, defaulting to `AUTOMATIC`. Persist the latest heartbeat/lease for each active session using the IAM-owned session persistence delivered by the session slice; no separate presence collection is required by this design.

Heartbeats, derived presence transitions, and preference changes are operational availability state, not account, credential, role, or permission mutations. They do not emit `audit.fact` v1/v2 records or use the transactional Outbox. The existing Audit contracts and sensitive-data rules remain unchanged.

## Delivery ownership

- **IAM-002 (User Persistence & Provisioning):** initialize `presence_preference` to `AUTOMATIC` for bootstrap and newly created users.
- **IAM-003 (Authentication & Session Lifecycle):** authenticate per-session heartbeats, maintain configurable leases, handle logout/revocation/expiry effects, expose self-service preference updates, and calculate effective presence.
- **IAM-004 (Authorization & HTTP Integration):** expose the typed public `UserPresencePort`, integrate the presence routes and current-principal representation with the existing HTTP contract, and preserve module boundaries.
- **IAM-006 (Integration & E2E):** verify multi-device aggregation, lease expiry, inactive/revoked sessions, preference behavior, and a consuming-module query through public contracts.

IAM-005 remains focused on administrative account/access changes. It does not let an IT Admin set another user's presence preference. No new ticket is proposed; update the existing Epic and relevant slice issues after this design is reviewed.

## Acceptance criteria

- Account `ACTIVE | INACTIVE` and presence `ONLINE | BUSY | AWAY | OFFLINE` are distinct in domain types, OpenAPI schemas, and documentation.
- One active device lease is sufficient for non-offline presence; logout/revocation/expiry of one session does not mark a user offline while another valid lease remains.
- All expired/revoked leases, or an inactive account, produce `OFFLINE` regardless of saved preference.
- With any live lease, `AUTOMATIC`, `BUSY`, and `AWAY` resolve to `ONLINE`, `BUSY`, and `AWAY` respectively.
- Clients cannot set effective `ONLINE` or `OFFLINE`; only the current authenticated user can change their preference.
- Ticket consumers query only their candidate user IDs through an IAM public contract; IAM owns no assignment-selection rules.
- Heartbeats and presence changes emit no Audit facts and contain no secrets in logs or responses.
- OpenAPI response envelopes, authentication requirements, and error responses follow existing IAM and platform HTTP conventions.

## Review checklist

- The 30-second heartbeat and 90-second lease lifetime are appropriate initial configurable PoC defaults.
- The `AUTOMATIC | BUSY | AWAY` preference should persist across devices and offline periods.
- Presence should remain outside durable Audit facts.
- Ticket distribution should own candidate selection and assignment policy, with IAM limited to user presence lookup.

# IAM module

IAM owns human identity and coarse-grained access capabilities for Dashboard,
AR, and Mobile clients. Its fixed role and permission catalog is provisional
and must be reviewed when a business capability is added. The initial catalog
contains 19 explicit permissions and no Agent Management permission.

## Role and permission rules

The system-defined roles are `IT_ADMIN`, `OPERATOR`, and `TECHNICIAN`. Each has
a fixed baseline in SPEC-002 §6. Effective permissions are the union of the
role baseline and the user's additional permissions. Additional permissions
must be catalog entries, unique, and absent from the role baseline. `user:manage`
and `user:grant` cannot be added to non-admin users. Wildcards and dynamic
permission codes are unsupported.

Changing a user's role clears all additional permissions. Account status is
independent of permission membership; an `INACTIVE` user cannot authorize.
Domain transitions protect the last active IT Admin. Persistence mutations
must enforce that invariant atomically with optimistic concurrency control;
the domain count supplied to a transition is a precondition, not a concurrency
guarantee by itself.

## Integration boundary

Consuming modules use `HumanAccessPort` and `HumanPrincipal` from the IAM
module's public exports. They do not import IAM domain or persistence internals.
IAM permissions are coarse capability checks only. The module that owns a
resource remains responsible for assignment, ownership, workflow state, and
record-level rules.

## User presence

Effective user presence is separate from account status. IAM stores a shared
`AUTOMATIC | BUSY | AWAY` preference and derives `ONLINE | BUSY | AWAY |
OFFLINE` from it and live device-session leases. An inactive account or a user
with no live lease is `OFFLINE`; otherwise `AUTOMATIC` becomes `ONLINE`.
Presence is only a coarse signal and grants no access or assignment guarantee.

The configurable initial heartbeat interval is 30 seconds and the session
lease lifetime is 90 seconds. The lease lifetime must exceed the heartbeat
interval. Each authenticated session renews only its own lease using server
time. Preferences apply across sessions and default to `AUTOMATIC`. Presence
state changes and heartbeat traffic do not emit Audit facts.

Consuming modules request presence only for their already-selected candidate
user IDs through `UserPresencePort`. Ticket and Maintenance own assignment,
eligibility, workload, fairness, and resource-specific policy; IAM does not
enumerate the user directory or make assignment decisions.

## Provisioning and bootstrap

There is no public sign-up route. An IT Admin creates an account through the
admin-protected `POST /api/v1/users` contract. IAM generates a temporary
credential, stores only its Argon2id hash, returns the plaintext once with
`Cache-Control: no-store`, and records the committed creation in the
transactional Outbox. The new user must change the temporary password before
using other protected routes.

Create the first IT Admin with `pnpm iam:seed-admin`, which starts the Nest
application context without opening an HTTP listener. Supply
`IAM_BOOTSTRAP_USERNAME`, `IAM_BOOTSTRAP_EMAIL`, and
`IAM_BOOTSTRAP_PASSWORD` to the seed process; `IAM_BOOTSTRAP_USER_ID` is
optional. Inject the initial password from the deployment secret manager only
for the seed job. The command never prints credentials, and repeated runs
return without changing an existing IT Admin. Deliver the configured initial
credential to the administrator through an approved secure channel; IAM
requires a password change at first login. Do not commit the password to an
environment file or source control.

## Authentication and browser deployment

Native AR/Mobile/WebView clients use `/api/v1/auth/login` and `/refresh` with
JSON access and refresh tokens; retain them in OS-protected secure storage.
The Dashboard uses `/api/v1/auth/browser/*`: the access token and CSRF proof
are returned in JSON, while the refresh token is an HttpOnly cookie. Browser
refresh and logout require both the current `X-CSRF-Token` and an exact
configured `Origin`. CORS allows credentials only for configured origins.
Prefer same-origin deployment behind a reverse proxy. Configured
cross-origin, same-site deployments use `SameSite=Lax`; cross-site cookie use
requires additional compatibility validation and explicit
`IAM_BROWSER_CROSS_SITE_COMPATIBILITY_VALIDATED=true` before selecting
`SameSite=None`.

Set `IAM_BROWSER_ALLOWED_ORIGINS` to a comma-separated list of exact HTTPS
origins (local HTTP origins are permitted for localhost development) and set
`IAM_BROWSER_CSRF_SECRET` from deployment secret management to at least 32
characters. The browser routes reject requests when an exact origin or CSRF
secret is not configured. Cookie `Domain` is omitted, and the Secure HttpOnly
cookie is scoped to `/api/v1/auth/browser`.

Authentication limits default to 5 login attempts per minute for each
source-IP/normalized-account pair and 30 refresh attempts per minute per
session. PoC counters are in process memory; a multi-instance deployment needs
shared rate-limit storage before treating the configured ceilings as global.
Access and refresh lifetimes default to 900 and 604800 seconds. JWT signing
uses configured RS256 keys, issuer, and audience. Credential-bearing responses
are `Cache-Control: no-store`; access and refresh credentials are never logged.

Account creation and password changes, their per-user Audit resource sequence
updates, and their `audit.fact` v1 Outbox records share one MongoDB
transaction. Sequence allocation uses an atomic compare-and-increment against
the expected stored sequence. A stale sequence returns a conflict and aborts
the transaction; it is not retried as a business operation. MongoDB must
support replica-set transactions.

# Ticket — P1-A read-only integration

`TicketReadPort.getTicket(id)` retrieves one canonical Zammad Ticket through
`ZammadTicketReadAdapter`. The port is internal to Ticket application code;
`TicketModule` provides it using the existing platform `ConfigService`.

The module is intentionally not imported into `CoreModule` in P1-A. It has no
controllers, public module contracts, database models, jobs or mutation methods.
The explicit real-read runner creates only this module's Nest application context.
Group scoping is an integration boundary, not Core user/resource authorization.

Configuration (ignored `.env.local` or injected environment):

| Setting                    | Rule                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ZAMMAD_BASE_URL`          | Exact HTTPS origin; loopback HTTP allowed for local verification. No URL credentials, path prefix, query or fragment. |
| `ZAMMAD_API_TOKEN`         | Required PAT; never log or commit it.                                                                                 |
| `ZAMMAD_EXPECTED_GROUP_ID` | Required positive safe integer; no instance-specific default.                                                         |
| `ZAMMAD_READ_TIMEOUT_MS`   | Optional, default 5000; integer 1–60000. Covers headers and body.                                                     |

Platform configuration retains these optional strings. Instantiating the Ticket
provider validates the complete set and fails with a sanitized configuration error.
Unconfigured integrations do not affect existing Core startup.

Only `GET /api/v1/tickets/{id}` is used. Redirects are refused. There is no
application retry, cache or local persistence. Missing or out-of-group Tickets
return `null`; other failures use fixed `TicketReadError.code` values. All mapped
response fields are validated without coercion; unselected upstream fields are
discarded. `nativeOwnerId` is not interpreted as Business Owner, and state IDs are
not mapped to business lifecycle names.

See the [P1-A mapping, tests and execution evidence](../../../docs/local/integration/flow04-p1a-zammad-read.md),
[accepted P0 observations](../../../docs/local/integration/flow04-p0-zammad-verification.md),
and [22-case Flow 04 plan](../../../docs/local/testing/flow04-test-matrix.md).

P1-B still requires approved Core identity/resource visibility contracts. P1-C
still requires ownership/context and recovery decisions. No broader IAM permission,
Article attribution, mutation, recovery or concurrency policy is approved by this slice.

## P1-B.1b internal additions

`ZammadUserAccessModule` is an opt-in internal provider, not part of CoreModule.
It additionally requires `ZAMMAD_SERVICE_USER_ID` and
`ZAMMAD_NON_HUMAN_USER_IDS` (a reviewed JSON array of non-human IDs). It uses
GET users/me and GET users/{id}, requiring active identities and direct full
access to the configured group. Human nature additionally requires explicit
provisioning review; Agent access alone does not establish it.

`ProvisionIdentityMapping` is a create-only internal use case depending on
public IAM, explicit provisioning authority, external eligibility, mapping
writer and platform UnitOfWork/Outbox ports. No authority implementation, CLI
or public administration endpoint is enabled. Its Mongo writer requires a
transaction and retains revoked bindings under both unique indexes. See the
[gate-resolution report](../../../docs/local/integration/flow04-p1b-gate-resolution.md)
for executed tests, configuration commands and remaining approval gates.

### Approved local activation (2026-11-20)

`LocalProvisioningAuthority` is disabled by default. Explicit development-only
configuration lists the designated administrator, exact pairs, instance/group
and approval reference. Its authentication port must resolve the real current
administrator through the public IAM API; caller-supplied IDs are not proof.
The approved local executor used this provider and the existing provisioning
use case; both mappings and downstream Audit records were verified. No provider
is registered in CoreModule and there is no public provisioning endpoint.

The verified custom field is `arimms_business_owner` (`_id` names are reserved).
Historical section 8 outcome: it was disabled after bounded probes. Direct Technician self-assignment
and Business Owner self-grant succeeded, so the writer-isolation gate fails.
P1-B.2 was blocked at that point. Section 9 and the latest status below supersede this outcome; public Ticket access remains unimplemented.

## Latest: private deployment and P1-B.2

`GetAuthorizedTicket` is an internal constructor-injected query using the public
IAM port, scoped forward/reverse mapping reads and canonical Zammad reads. It
returns allowed/denied/not_found and keeps dependency errors distinct. Only
OPERATOR/TECHNICIAN are business actors. Technician visibility requires valid
Business Owner identity and current Owner-or-Assignee responsibility. Missing or
invalid Owner data is denied for Technicians, including current Assignees;
permitted Operators can inspect it for repair. IT_ADMIN and extra permissions do
not bypass these checks. The future caller must supply a trusted authenticated
Core ID, not a client-selected ID. No public endpoint or CoreModule registration.

The approved private deployment uses `http://zammad-nginx:8080` with exact
`ZAMMAD_PRIVATE_HTTP_ORIGIN` opt-in. Zammad and the selected Mongo publish no host
ports; Core publishes 8082. The maintenance mTLS gateway is stopped by default.
Attribute 60 is active after successful representative isolation checks. See
[deployment commands and rollback](../../../deploy/flow04/README.md) and section 9
of the gate report for fresh tests and the remaining actual-client release gate.
Earlier blocked-state notes are historical.

## Public workflow implementation

The secured PoC enables the authenticated workflow controller and the minimal
detail controller. Zammad remains authoritative for Ticket state, Owner,
Assignee and Articles. Core stores business references and operation receipts.
Each mutation requires a stable operation key. A verified checkpoint can finish
context and Audit after restart, while uncertain writes stay blocked from
automatic reissue. Repository tests and real fixture evidence are linked in the
[completion report](../../../docs/local/integration/flow04-backend-completion.md).
The [client API guide](../../../docs/local/integration/flow04-ticket-api-guide.md)
describes the current routes, authorization and unresolved integration gates.

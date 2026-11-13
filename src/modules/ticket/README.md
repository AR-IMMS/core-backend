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

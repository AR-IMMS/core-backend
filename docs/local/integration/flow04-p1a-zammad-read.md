# Flow 04 — P1-A implementation and verification

Date: 2026-11-12 (Asia/Bangkok). Branch: `feat/ticket-management`.

> Publication note (2026-11-13): this documentation is published before the P1-A code. Implementation observations and test evidence describe the local working tree from 2026-11-12. New source/test paths below are plain text until a later code commit; existing source links may show the earlier committed version.

Scope: user-authorized read-only adapter only. P0 observations are accepted;
later ownership, IAM, visibility, attribution, recovery and concurrency decisions
are still separate gates. No commit or submodule change was made.

## Implementation and files

| File                                                                                                         | Purpose                                                                          |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `src/modules/ticket/application/ticket-read.port.ts`                                                         | Internal `TicketReadPort`, immutable read DTO, DI token, sanitized error codes   |
| `src/modules/ticket/infrastructure/zammad-ticket-read.adapter.ts`                                            | Single-instance scoped GET with strict parsing and bounded transport             |
| `src/modules/ticket/infrastructure/zammad-read.config.ts`                                                    | Complete integration settings validation without raw validation errors           |
| `src/modules/ticket/ticket.module.ts`                                                                        | Nest factory provider using the existing platform configuration                  |
| [env.schema.ts](../../../src/platform/config/env.schema.ts)                                                  | Retain four optional Zammad settings; provider validates them on composition     |
| [.env.example](../../../.env.example)                                                                        | Commented configuration guidance; no credential or group default                 |
| `src/modules/ticket/infrastructure/zammad-read.config.spec.ts`                                               | 20 cases: configuration boundaries, defaults, optional platform settings         |
| `src/modules/ticket/infrastructure/zammad-ticket-read.adapter.spec.ts`                                       | 22 cases: mapped fields, invalid IDs/data, isolation and sanitized failures      |
| `src/modules/ticket/infrastructure/zammad-ticket-read.http-contract.spec.ts`                                 | 21 cases using a real loopback HTTP server and native fetch                      |
| `test/ticket-zammad-read.real.ts`                                                                            | Explicit opt-in GET through the actual Nest provider; not a Jest-discovered test |
| [Ticket README](../../../src/modules/ticket/README.md), [repository README](../../../README.md), this report | Setup, navigation, supported behavior and evidence                               |

The two pre-existing untracked P0 documents are preserved. No production
composition/controller, IAM, shared business source, API contract, dependency,
lockfile or Mongo collection was changed. `TicketModule` is not imported into
`CoreModule`; it exports no cross-module contract. Application imports no Nest,
Zod, HTTP or database code. Only the infrastructure layer knows Zammad transport.

## Interface, mappings and error behavior

```typescript
getTicket(id: number): Promise<ExternalTicket | null>
```

IDs must be positive safe integers. The only target is the configured origin,
using `GET /api/v1/tickets/{id}`. No caller-supplied URL, redirect, application
retry, list/search, Article access or mutation exists. Authentication is a PAT
header. The timeout includes receiving the response body. Credentials, upstream
bodies, URLs and original error causes are excluded from errors/logging.

| Zammad field  | Application field  | Validation                                              |
| ------------- | ------------------ | ------------------------------------------------------- |
| `id`          | `externalTicketId` | Positive safe integer; must equal requested ID          |
| `number`      | `number`           | Nonempty string; retains display identifier             |
| `title`       | `title`            | Nonempty string, retained verbatim                      |
| `group_id`    | `groupId`          | Positive safe integer; must equal configured group      |
| `owner_id`    | `nativeOwnerId`    | Positive safe integer; no Business Owner interpretation |
| `customer_id` | `customerId`       | Positive safe integer; no Core identity inference       |
| `state_id`    | `stateId`          | Positive safe integer; no lifecycle-name mapping        |
| `priority_id` | `priorityId`       | Positive safe integer; no business-priority mapping     |
| `created_at`  | `createdAt`        | ISO datetime with timezone                              |
| `updated_at`  | `updatedAt`        | ISO datetime with timezone; not a concurrency token     |

Unknown additional fields are discarded, not exposed. Unknown positive state IDs
remain raw IDs. Native owner ID 1 is preserved without assigning responsibility
semantics. Null/missing/non-numeric identifiers, unsafe integers, invalid dates,
wrong requested IDs, malformed JSON and unexpected response shapes fail closed.
Only HTTP 200 with `application/json` (parameters allowed) is parsed as a Ticket.

Unsupported: Business Owner, Core actor mapping, custom attributes, organizations,
tags, Articles/bodies, attachments, customer details, SLA/escalation fields,
pending scheduling, expanded relations and all other unselected response fields.
Only one configured origin/group is supported. Subpath installations, multi-instance
routing and end-user resource authorization are outside P1-A.

| Condition                                           | Result                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| 404 or valid Ticket from another group              | `null`, no Ticket data                                                           |
| Invalid requested ID                                | `INVALID_TICKET_ID`, before transport                                            |
| 401 / 403                                           | `UPSTREAM_ACCESS_DENIED`; integration credential failure, not a Core user denial |
| 429 / 5xx or connection failure                     | `UPSTREAM_UNAVAILABLE`                                                           |
| Timeout before headers or during body               | `UPSTREAM_TIMEOUT`                                                               |
| Invalid JSON/media type/selected fields/response ID | `INVALID_UPSTREAM_RESPONSE`                                                      |
| Other statuses, including redirects                 | `UNEXPECTED_UPSTREAM_STATUS`                                                     |

Group scope does not resolve the restricted Technician visibility decision.
The provider cannot be exposed as a public read API without application-level
IAM/resource authorization. No ETag, If-Match, receipt, operation journal or
canonical Ticket persistence was introduced.

## Executed verification

Node **22.22.3**, pnpm **11.9.0**, frozen repository lockfile. Node was downloaded
into ignored `.tmp/node-22.22.3`, checked against the official SHA-256 manifest,
and used without changing the global Node installation. The global installation
was 22.23.0, so final commands explicitly used the pinned executable. Dependency
installation initially failed in the network sandbox, then succeeded with approved
network access. No manifest/lockfile dependency changes occurred.

| Check                                          | Actual result                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Unit tests                                     | **PASS: 47/47** (42 new + 5 existing environment-schema regression cases) |
| Fake-Zammad HTTP contract                      | **PASS: 21/21**                                                           |
| Real Zammad GET through Nest provider          | **PASS**, Ticket 3 in group 2; details below                              |
| TypeScript `typecheck`                         | **PASS**, exit 0                                                          |
| Repository non-mutating ESLint                 | **PASS**, exit 0                                                          |
| Formatting of all changed/new TypeScript files | **PASS**, exit 0                                                          |
| Repository `format:check`                      | **FAIL**, 335 unchanged files reported; no bulk reformat performed        |
| Production `build`                             | **PASS**, exit 0                                                          |
| Full repository Jest coverage run              | **PASS: 104 suites, 551/551 tests**, exit 0; 108.493 seconds              |

Sampled formatting failures in `src/app/core.module.ts` and
`src/platform/config/env.schema.spec.ts` are unchanged relative to HEAD after
line-ending normalization: checked-out CRLF versions fail Prettier, while HEAD
versions pass. The only modified existing TypeScript file (`env.schema.ts`) and
all new TypeScript files pass. This does not turn the full formatting command into
a pass.

Initial development runs found an unsafe malformed-URL exception and a JSON error
classification issue; both were fixed and the final cases passed. A first attempt
to bootstrap the complete config module inside Jest encountered the existing
Node 22/Jest/@nestjs-config ESM loader incompatibility. Fake HTTP tests now test
the adapter at its transport boundary; the real runner verifies actual Nest
composition under Node. No global Jest configuration or dependencies were changed.

The fake contract cases cover request path/method/header placement, 404, foreign
group, 401/403/400/429/500/503, four redirect statuses, malformed JSON/media types/
shapes/IDs, header/body stalls, socket disconnect and connection refusal.

These are P1-A technical tests, not 63 new BM04 business cases. The existing
[22 unique planned cases](../testing/flow04-test-matrix.md) remain the business
inventory; none is declared fully accepted by this adapter slice. Local execution
is not CI automation. HTTP application integration and actual Web/Mobile E2E were
not implemented or executed.

## Exact commands

Run in PowerShell from `core-backend`. These are the final session commands. On a
machine already using pinned Node 22.22.3, `pnpm.cmd` can replace `node $p1Pnpm`.
The explicit Corepack entry point below avoids the global `pnpm.cmd` shim selecting
its adjacent Node 22.23.0 executable.

```powershell
Set-Location 'C:\Users\Admin\AR-IMMS backend\core-backend'
$env:Path = (Join-Path (Get-Location) '.tmp\node-22.22.3\node-v22.22.3-win-x64') + ';' + $env:Path
$p1Pnpm = Join-Path (Split-Path (Get-Command pnpm.cmd).Source) 'node_modules\corepack\dist\pnpm.js'
node --version
node $p1Pnpm exec node --version

# Unit + existing configuration regression tests: 47 passed
node $p1Pnpm test --runInBand --runTestsByPath src/modules/ticket/infrastructure/zammad-read.config.spec.ts src/modules/ticket/infrastructure/zammad-ticket-read.adapter.spec.ts src/platform/config/env.schema.spec.ts

# Fake-Zammad HTTP contract: 21 passed
node $p1Pnpm test --runInBand --runTestsByPath src/modules/ticket/infrastructure/zammad-ticket-read.http-contract.spec.ts

node $p1Pnpm typecheck
node $p1Pnpm exec eslint "{src,apps,libs,test}/**/*.ts"
node $p1Pnpm exec prettier --check 'src/modules/ticket/**/*.ts' src/platform/config/env.schema.ts test/ticket-zammad-read.real.ts
node $p1Pnpm format:check
node $p1Pnpm build
node $p1Pnpm test:cov --runInBand
```

## Real-instance read evidence

Using the existing ignored `.env.local` for `ZAMMAD_BASE_URL` and the PAT; no
credential output. This run sets the already verified group ID as test deployment
configuration, not business logic. The runner requires an explicit expected origin
and Ticket ID and exposes no HTTP server. It performs one GET and no writes.

```powershell
$env:ZAMMAD_EXPECTED_GROUP_ID = '2'
$env:ZAMMAD_READ_TEST_TICKET_ID = '3'
$env:ZAMMAD_READ_TEST_EXPECTED_BASE_URL = 'http://localhost:8081'
node -r ts-node/register -r tsconfig-paths/register test/ticket-zammad-read.real.ts
```

Actual output (sanitized by the runner):

```json
{
  "result": "PASS",
  "verification": "real Zammad GET through Nest provider",
  "nodeVersion": "v22.22.3",
  "externalTicketId": 3,
  "number": "11003",
  "groupId": 2,
  "nativeOwnerId": 5,
  "customerId": 7,
  "stateId": 2,
  "priorityId": 2,
  "createdAt": "2026-11-11T19:43:38.122Z",
  "updatedAt": "2026-11-11T19:48:43.751Z"
}
```

The selected environment/version is the [verified P0 instance](flow04-p0-zammad-verification.md).
The response mapping matched its observed canonical identifiers. Title also passed
the strict parser but is intentionally omitted from runner output. Negative/error
conditions were exercised against the fake server, not by changing real accounts
or the Zammad environment. P1-A created or modified no Tickets.

## Review decisions and remaining gates

Implementation choices for review: exact origin configuration, one required group,
`null` for missing/out-of-scope results, ten-field allowlist, fixed internal error
codes, bounded timeout, no redirects/application retries, provider not yet composed
into Core. These are internal read-boundary choices, not new public API or business
contracts. Zammad remains canonical.

- **P1-B blocked:** approve Core-to-Zammad identity mapping and resource-level read
  visibility, including managers, Technicians, Articles/context and list counts;
  define the public HTTP contract and authorization tests before any controller.
- **P1-C blocked:** choose Business Owner/Assignee representation, initial/default
  ownership and minimum Core context; approve durable request identity and recovery,
  including delayed/empty search and manual fallback. No persistence was added here.
- Delegated Article attribution, work permissions and mutation concurrency remain
  later gates. Incident/Maintenance integration still requires approved public
  module contracts. Formal BM04 approval/version remains pending.

P1-A ends here; no P1-B/P1-C implementation or public Ticket API is authorized.

# Flow 04 P1-B.1 ? internal identity foundation

Date: 2026-11-19. Scope: P1-B.1 only. No public Ticket endpoint, provisioning command, actual human binding, IAM permission/schema change or CoreModule registration.

## Implemented files and boundaries

- `src/modules/ticket/domain/identity-mapping.ts` and adjacent spec: framework-free identity configuration and validation.
- `src/modules/ticket/application/identity-mapping-read.port.ts`: `findActiveMapping(coreUserId): Promise<IdentityMapping | null>` and private DI token.
- `src/modules/ticket/infrastructure/mongodb/identity-mapping.schema.ts`: strict Mongoose schema and two named unique indexes.
- `src/modules/ticket/infrastructure/mongodb/mongo-identity-mapping.store.ts` and adjacent spec: scoped read implementation, ambiguity detection in both directions and sanitized failures.
- `src/modules/ticket/ticket-identity.module.ts`: internal Mongo feature composition; validates configuration and creates required indexes before exposing its read provider. Host must supply an existing Mongo connection. Neither this module nor TicketModule is imported into CoreModule. P1-A's standalone module is unchanged.
- `src/platform/config/env.schema.ts`, `.env.example`: optional `ZAMMAD_INSTANCE_KEY`; required and validated when identity module is activated. No hardcoded instance/group IDs.
- `test/ticket-identity-mapping.integration.ts`: opt-in real Mongo persistence tests using synthetic IDs in a guarded `_test` database, deleting only fixtures for their random instance key.
- This report and the overall architecture document describe actual status. The existing design remains the design history; the latest user approval supersedes its pending mapping/visibility decisions.

## Schema and behavior

Collection: `ticket_zammad_identity_mappings`. Fields: instanceKey, coreUserId, zammadUserId, approvedGroupId, ACTIVE/REVOKED status, positive revision, approving Core user ID, approval reference, validation/creation/update timestamps. Instance/core/external identity keys are immutable under Mongoose document operations. No runtime email, credentials, IAM role clone or canonical Ticket fields.

Unique indexes `uq_ticket_identity_core(instanceKey, coreUserId)` and `uq_ticket_identity_zammad(instanceKey, zammadUserId)` cover all statuses. They are not partial indexes. Startup calls createIndexes without dropping existing indexes and fails if duplicates prevent enforcement. No records are provisioned. This follows existing Mongoose feature-schema conventions; no independent migration registration is necessary while the module remains inactive in the host.

The store checks forward and reverse ambiguity even if a database is improperly indexed. Missing/revoked/wrong-group or wrong-instance mappings return null. Invalid persisted data or ambiguity throws MAPPING_INTEGRITY; infrastructure errors become MAPPING_UNAVAILABLE without raw causes. Invalid lookup IDs fail before a database call. Instance configuration is copied/frozen.

ACTIVE means the mapping is administratively enabled, not that the human is active now. Live Core inactivity, revoked sessions and external inactivity must still deny access in P1-B.2 using public IAM and a verified external access contract. No authorization use case is implemented or implied here. Unsupported INACTIVE mapping status is rejected; the approved mapping lifecycle uses REVOKED. Revision is metadata for future approved administration, not an implemented concurrency/provisioning workflow. Direct database writes remain privileged operations and can bypass Mongoose validation; runtime reads reject invalid documents.

## Actual verification

- Focused Jest: **83 PASS** = 15 new mapping unit cases, 47 existing P1-A/configuration unit cases, 21 fake-Zammad HTTP contract cases. These are technical cases, not new BM04 IDs.
- Real Mongo persistence: **8 PASS**. Both uniqueness directions were tested for ACTIVE and REVOKED records, plus missing/revoked/wrong-scope/corrupt records and unsupported inactive status.
- Real Ticket GET through existing Nest provider: **PASS**, Ticket 3, number 11003, group 2, owner 5, customer 7, state 2, priority 2.
- Full Jest coverage run: **106 suites, 566 tests PASS**, 99.66 seconds.
- Changed-file formatting and git diff whitespace checks: **PASS**. Full repository formatting: **FAIL**, the same 335 unrelated CRLF files; none changed.
- TypeScript including test sources, repository-wide non-mutating ESLint and production build: **PASS**, exit 0.

Initial Mongo tests in Jest failed at connection metadata negotiation (`Missing required sub-document driver`). The repository already uses standalone ts-node integration runners; the new persistence runner uses Node's test API outside Jest and passed against real Mongo. Initial test typing/lint issues were corrected. No dependency or global Jest configuration changes were made. Local execution is not completed CI automation.

Exact commands (PowerShell, repository root, Node 22.22.3):

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/modules/ticket/domain/identity-mapping.spec.ts src/modules/ticket/infrastructure/mongodb/mongo-identity-mapping.store.spec.ts src/modules/ticket/infrastructure/zammad-read.config.spec.ts src/modules/ticket/infrastructure/zammad-ticket-read.adapter.spec.ts src/modules/ticket/infrastructure/zammad-ticket-read.http-contract.spec.ts src/platform/config/env.schema.spec.ts
$env:MONGODB_TEST_URI='mongodb://127.0.0.1:27017/ar_imms_ticket_identity_test?replicaSet=rs0&directConnection=true'
node -r ts-node/register -r tsconfig-paths/register test/ticket-identity-mapping.integration.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.spec.json
node node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"
node node_modules/@nestjs/cli/bin/nest.js build
node node_modules/jest/bin/jest.js --coverage --runInBand
node node_modules/prettier/bin/prettier.cjs --check 'src/modules/ticket/**/*.ts' src/platform/config/env.schema.ts test/ticket-identity-mapping.integration.ts
```

The repository Mongo service was started with `docker compose up -d --wait mongodb`; no data was reset/deleted. The existing Zammad containers were already running and were not restarted. The separate port-8080 stack was untouched.

## Read-only Zammad observations

Selected origin http://localhost:8081, scoped Ticket group 2. Existing ignored environment credential used without printing it. `docker exec zammad-docker-compose-zammad-railsserver-1 cat /opt/zammad/VERSION` returned **7.2.2-45de44f1.docker**.

Credential-authenticated GET observations:

| Request               | Result                                                                      |
| --------------------- | --------------------------------------------------------------------------- |
| `/api/v1/users/me`    | 200, service ID 6, active true, role_ids [2], group_ids {2: [full]}         |
| `/api/v1/users/4`     | 200, active true, role_ids [2], direct group 2 full                         |
| `/api/v1/users/5`     | 200, active true, role_ids [2], direct group 2 full                         |
| `/api/v1/roles/2`     | 200, active true, group_ids empty, permission_ids [60,62,65,68,70]          |
| `/api/v1/permissions` | 404; attempted catalog route does not provide a runtime permission contract |
| `/api/v1/tickets/3`   | 200, expected canonical ID, group and native owner                          |

Read-only Rails inspection of those permission IDs returned chat.agent, cti.agent, knowledge_base.reader, **ticket.agent**, user_preferences; no administrative permission in the observed service role. The existing credential could read users and roles without permission elevation. This proves the selected accounts' direct full group access and effective Agent capability with supplementary server evidence. It does **not** demonstrate a credential-only generic permission-resolution contract or role-derived group merge semantics. Therefore no external-user authorization adapter is implemented yet; do not hardcode permission ID 68 or infer capability from role name/ID. No roles, memberships, ownership or fields were modified.

The temporary read probes used `.tmp/p1b-access.cjs` and `.tmp/p1b-permissions.cjs`, emitting only allowed IDs/status/access data. These are ignored investigation helpers, not production adapters.

Existing real Ticket verification command:

```powershell
$env:ZAMMAD_EXPECTED_GROUP_ID='2'
$env:ZAMMAD_READ_TEST_TICKET_ID='3'
$env:ZAMMAD_READ_TEST_EXPECTED_BASE_URL='http://localhost:8081'
node -r ts-node/register -r tsconfig-paths/register test/ticket-zammad-read.real.ts
```

## Business Owner attribute verification procedure ? approval required before mutation

1. Inventory supported object attribute types read-only on this version. Propose one explicit scalar external user ID; validate integer range, null behavior and type immutability. Do not assume a relational user selector exists. Submit exact field definition for approval.
2. After separate permission to install a disposable field, verify REST create/read/update round-trip with native owner remaining unchanged, and test absent, null, malformed, unknown, inactive, customer, service/system and wrong-group identity values. Existence and eligibility must be validated, not inferred from integer shape.
3. Establish initial Owner and imported Ticket handling with the business owner. No silent creator/customer/default-service Owner fallback. Decide whether missing Owner blocks Technician access.
4. Verify field history records old/new values, actor, timestamp and UI/API changes; confirm assignment does not overwrite accountability.
5. Test an explicit writer matrix: authorized Core operation, Operator, Admin, assigned Technician, unrelated Technician and customer using each account's UI/API access. Attempt self-granting Business Owner, changing native assignment, changing both, and moving groups. Record both response and canonical readback; UI-hidden fields alone are insufficient.
6. Require server-enforced writer restrictions or an explicitly approved trusted-writer model. Core-only checks cannot prevent full-access Zammad agents reading all group Tickets or editing an Owner field directly. If self-grants or direct bypass cannot be prevented under the required model, stop and review permissions/writer policy or the Core-owned context alternative. Do not choose that alternative silently.
7. Preserve evidence and restore only the specifically approved disposable fixtures. No custom-field work, ownership mutation or account/permission changes are authorized by this procedure itself.

## Pending gates and next phase

Provisioning authority, operator authentication/runbook, approval/audit procedure, service/sentinel exclusion and live-user eligibility remain pending. There is intentionally no write port or unrestricted provisioning command. No actual Core-to-Zammad human pair has been approved or inserted.

Before P1-B.2: review this foundation; approve provisioning authority and explicit seed pairs; demonstrate a runtime external-access contract with least privilege; finalize authoritative Business Owner representation, writer restrictions and existing-Ticket handling; accept read snapshot/revocation limits. Then approve the authorization-use-case phase explicitly. P1-B.3 public HTTP remains separate. No Ticket mutations or creation recovery mechanisms were introduced.

References: [accepted design](flow04-p1b-identity-authorization-design.md), [P1-A evidence](flow04-p1a-zammad-read.md), [overall architecture](../architecture/flow04-ticket-zammad-backend-design.md), [unchanged 22-case matrix](../testing/flow04-test-matrix.md). BM04 numerical targets remain unchanged and formal approval/version verification remains pending. Neither adapter nor mapping tests complete business acceptance or Web/Mobile E2E.

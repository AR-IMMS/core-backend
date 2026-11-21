# WF-04 backend implementation and completion evidence

Work on `feat/ticket-management`. The accepted private deployment and P1-B.2 are the starting point. The 22-case business inventory is separate and stays intact.


## Integration handoff and CI

**2026-11-21 local verification on `feat/ticket-management`.** The PR workflow now runs the repository quality gates, deterministic Ticket/IAM contracts and the mapping/journal integration against an isolated MongoDB replica set. The secured PoC acceptance below describes the previously executed live run. This handoff did not re-run live Ticket mutations, change the PoC or deploy a build. **GitHub Actions, staging and actual Web/Mobile/MR were NOT RUN.**

| Local check | Result |
| --- | --- |
| Frozen install, TypeScript, repository ESLint and production build | PASS |
| Full Jest with coverage | PASS, 739 tests across 115 suites |
| Focused Ticket/IAM Jest | PASS, 383 tests across 39 suites |
| Ticket controller HTTP and fake-Zammad Jest | PASS, 55 tests across four suites, included in the focused run |
| Disposable MongoDB 8 replica set | PASS, 14 mapping cases and the journal transaction, recovery and contention scenarios |
| Ticket and IAM OpenAPI, scoped formatting and dependency audit | PASS |
| Selected PoC read-only readiness and Swagger | PASS, both HTTP 200; methods, paths and permission metadata match all 13 static Ticket operations. Private Mongo and Zammad have zero host bindings. |

See the executable commands, isolated fixture manifest, and opt-in real runner in the [CI and real verification runbook](../testing/flow04-ci-runbook.md). The original 22 IDs still have 13 backend verified, five partial and four blocked in the live acceptance inventory. At their full required layers, three cases have complete PR automation (two Feature), 18 have partial PR automation, and one requires staging. The 11-case and seven-Feature commitments remain open. [Traceability by original ID](../testing/flow04-test-matrix.md#ci-coverage-by-original-case)

### API readiness

API paths are relative to `/api/v1/tickets`. ?Integrate? means the client team can consume the contract through Core. Acceptance on actual clients remains pending for all rows. [13-operation integration guide and client checklist](flow04-ticket-api-guide.md)

| UC | API | Backend ready | Client ready | Cross-module dependency |
| --- | --- | --- | --- | --- |
| 63 | POST `/` | Yes, manual without Incident | Integrate manual create | Incident for optional Incident input |
| 64 | POST `/from-reviewed-draft` | Blocked, HTTP 503 | Keep action unavailable | Incident reviewed revision, evidence, atomic claim |
| 65 | GET `/` | Yes | Integrate scoped listing | Core IAM |
| 66 | GET `/:id` | Yes | Integrate, handle non-disclosing 404 | Core IAM |
| 67 | PATCH `/:id` | Yes | Integrate for Operator | Core IAM |
| 68 | PATCH `/:id/responsibilities` | Yes | Integrate separate Owner and Assignee fields | Core IAM and scoped identities |
| 69 | POST `/:id/status` | Yes | Integrate three supported progress transitions | Core IAM work permission |
| 70 | POST `/:id/articles` | Yes | Integrate internal notes and same-key recovery | Core IAM work permission |
| 71 | GET `/:id/articles` | Yes | Integrate scoped timeline | Core IAM |
| 72 | PATCH `/:id/links` | Partial | Integrate supported Asset and local link controls | Asset fixture; Incident and Maintenance providers |
| 73 | GET `/:id/links` | Partial | Integrate confirmed link display | Incident and Maintenance providers for populated context |
| 74 | POST `/:id/close` | Yes | Integrate valid current Owner closure | Core IAM close permission |
| 75 | POST `/:id/reopen` | Yes | Integrate authorized reopening | Core IAM management permission |
| 76 | Scoped reads, progress and Articles above | Yes | Integrate Technician flow; run on actual Mobile | Core IAM and seeded client environment |

**Backend integration ready** for the available endpoints and supported link operations. Incident draft and provider-backed context await the [owning-module contracts](flow04-owning-module-handoff.md). **Production release remains NO-GO** pending approved providers, seeded staging and physical-client evidence, the remaining acceptance thresholds, and formal BM04 approval.

## Final backend acceptance

**2026-11-21.** Acceptance ran against the secured PoC. Incident and Maintenance public providers remain absent in this checkout. The only available seams are the optional Ticket-facing port and the Asset lookup; the generic Asset Maintenance state seam does not validate a Maintenance Activity. No adapter or private collection access was added. Reviewed draft creation, manual creation with an Incident reference and setting a primary Incident link returned 503 over authenticated HTTP. Ticket-only and Asset-only paths remain available. [Owning-module handoff](flow04-owning-module-handoff.md)

- **Ticket 16, actual three-role HTTP.** Operator created and replayed, assigned and updated the Ticket. Technician worked NEW → OPEN → PENDING → OPEN, appended one internal Article with same-key replay, and was denied after assignment loss. The run confirmed the canonical snapshot was unchanged after denied Technician management, an unsupported state transition, non-Owner closure and unauthorized reopening. The current Owner closed and Operator reopened. IT_ADMIN was denied every Ticket operation. Fourteen Audit records were verified, including Technician attribution. Separate negative probes checked unsupported CLOSED through the status DTO (400), denied Technician create (403 with no journal receipt and no matching Ticket), and missing Incident provider responses.
- **Ticket 17, real recovery and race evidence.** The fault harness invoked actual Zammad writes and injected response loss at the outbound application port. The real HTTP retry returned 409 `TICKET_UNRESOLVED` without redispatch. With a verified candidate, an injected Audit commit failure left no context, and the real HTTP retry of the same key returned the original Ticket and finished context. The real HTTP Article retry returned the original Article; Zammad contained exactly one recovery note. During a held Owner-transfer lock, real HTTP competing assignment and close returned 409. After transfer the former Owner received 403 for closure; the Ticket remained OPEN.
- **Data and boundary evidence.** Canonical fixtures 16 and 17 retained exactly two notes each. Ticket 3 retained its original timestamp and values. Ticket 11 remains locked with a `dispatching` receipt and no verified result. The secured PoC kept Zammad and MongoDB unpublished; the representative bridge could reach Core but none of the selected private Zammad routes or the closed maintenance path. After the Swagger refresh, the three-role regression passed again on existing Ticket 16.
- **Verification.** 728 Jest tests in 115 suites, including 372 Ticket/IAM regressions in 39 suites, passed. Fourteen dedicated Mongo mapping tests and the journal rollback/recovery/contention checks passed. TypeScript, ESLint, production Docker build, Redocly validation of IAM and Ticket OpenAPI and readiness passed. Live Swagger matched the permission annotations for all 13 operations and the four ownership-dependent descriptions. Image manifest `sha256:47e958bee8027ec731c74ac16c0c7e9d59f92dd12799f8e4ea637a588e903c5c`.

### UC-63–76 integration table

| UC | Status | Verified evidence | Blocker or owning module |
| --- | --- | --- | --- |
| 63 | Backend ready | Ticket 16 manual create and same-key replay. Denied create returned 403 without a receipt. | Ticket; Web/Mobile acceptance still due |
| 64 | Blocked | Operator reviewed-draft request returned 503. | Incident owner: reviewed revision, evidence, atomic claim and canonical completion contract |
| 65 | Backend ready | Live Operator/Technician visibility, scoped list and filtering on disposable Tickets. | Ticket |
| 66 | Backend ready | Live authorized detail and non-disclosing denial, before and after reassignment. | Ticket |
| 67 | Backend ready | Operator updated title and priority on Ticket 16. Technician mutation denied without changes. | Ticket |
| 68 | Backend ready | Operator assigned and reassigned; Technician self-grant denied. Canonical Owner remained separate where expected. | Ticket |
| 69 | Backend ready | Three live Technician progress transitions and rejection of unsupported transition. | Ticket and IAM approved work policy |
| 70 | Backend ready | Live internal Technician Article and same-key replay on Ticket 16, with injected-loss recovery on Ticket 17. | Ticket; physical client evidence still due |
| 71 | Backend ready | Technician read Articles under current visibility and preserved timeline after reopen. | Ticket |
| 72 | Partially ready | Current link write boundary and empty-context preservation verified. No live Asset fixture in this PoC run. | Ticket/Asset supported; approved Incident and Maintenance providers absent |
| 73 | Partially ready | Live links read after reopening, with no unverified external references. | Incident/Maintenance needed to verify populated links |
| 74 | Backend ready | Current Owner closed Ticket 16; non-Owner and Technician without close permission denied. Former Owner denied after transfer on Ticket 17. | Ticket |
| 75 | Backend ready | Operator reopened the same Ticket; unauthorized reopening left it CLOSED. | Ticket |
| 76 | Backend ready, client acceptance pending | Real Technician list, read, work, Article and access-loss tests using the public API. | Mobile/Web product owners to run seeded physical-client acceptance |

### Acceptance evidence

Thirteen of the original 22 cases now have **backend verification**. Cases that explicitly require physical clients, owning-module data, or a missing negative live identity fixture remain incomplete. The total is not a production or BM04 pass rate. No staged CI execution or physical Web/Mobile/MR pass is claimed. [Original inventory](../testing/flow04-test-matrix.md)

| TC-WF04 | Disposition | Evidence or missing requirement |
| --- | --- | --- |
| 01 | Partial | Ticket 16 creation/replay passed; actual Web and Mobile identity handoff pending. |
| 02 | Blocked | Real 503 confirmed; reviewed Incident contract missing. |
| 03 | Backend verified | Live 403 unauthorized create, no matching Ticket visible and no local receipt. |
| 04 | Partial | Actual assignment and independent Owner readback; client evidence pending. |
| 05 | Partial | Actual Technician progress, Article and Audit passed; physical cross-client scenario pending. |
| 06 | Backend verified | Real Technician management/self-grant and IT_ADMIN rejection; Ticket snapshot unchanged. |
| 07 | Partial | Actual non-Owner closure rejected with readback unchanged; physical DS-04b demo pending. |
| 08 | Backend verified | Unauthorized reopening 403 left the same Ticket CLOSED. |
| 09 | Blocked | Ticket history preserved, but real Incident/Maintenance lifecycle composition unavailable. |
| 10 | Blocked | No approved Incident or Maintenance providers, no live populated link/client evidence. |
| 11 | Backend verified | Actual create acceptance with injected loss, HTTP unresolved response and same-key recovery of exact ID. |
| 12 | Backend verified | Injected local commit failure followed by HTTP completion of verified checkpoint without another create. |
| 13 | Backend verified | Technician NEW → OPEN over HTTP. |
| 14 | Backend verified | Technician OPEN → PENDING over HTTP. |
| 15 | Backend verified | Technician PENDING → OPEN over HTTP. |
| 16 | Backend verified | Exact current Business Owner OPEN → CLOSED over HTTP. |
| 17 | Backend verified | Authorized CLOSED → OPEN over HTTP; unchanged canonical identity. |
| 18 | Blocked | Full Web/Mobile demo, staging and physical evidence unavailable. |
| 19 | Backend verified | Live repeated OPEN rejected with 409; CLOSED on the status DTO rejected with 400. Canonical readback unchanged. |
| 20 | Partial | Live configured identities and scope verified; missing/revoked/wrong-group mappings tested with fixtures in code/Mongo. No disposable bad mapping and independent active principal configured for a live negative matrix. |
| 21 | Backend verified | Real HTTP contention during held transfer, followed by denied stale close and unchanged OPEN state. |
| 22 | Backend verified | Actual Article accepted before injected loss, same-key authenticated HTTP recovery and exactly one matching Zammad note. |

| Decision | Status |
| --- | --- |
| Backend integration readiness | **GO** for verified Ticket-only and supported Asset-link contract paths on the secured PoC. Keep Incident-dependent submissions fail-closed and omit unverified cross-module links. |
| Production release readiness | **NO-GO**. Needs approved Incident/Maintenance public contracts, seeded physical Web/Mobile/MR and staging acceptance, remaining live identity matrix and formal BM04 threshold/approval evidence. |

### Reproduce live acceptance

Run only in the authorized secured PoC. The opt-in runners create new disposable fixtures. The fault harness injects outbound failures in a separate application context. It sends legitimate bearer credentials to live Core via stdin and never passes them as process arguments.

```powershell
$env:FLOW04_EXPECT_TECH_WORK='true'
$env:FLOW04_REAL_TICKET_FIXTURE_ID='13'
$env:FLOW04_DISPOSABLE_HTTP_WORKFLOW='true'
node test/ticket-api.real.cjs
Remove-Item Env:FLOW04_DISPOSABLE_HTTP_WORKFLOW
docker cp test core-backend-core-1:/app/test
node -e "const t=require('dotenv').parse(require('fs').readFileSync('.tmp/flow04-ticket-sessions.env')).CORE_OPERATOR_TOKEN;if(!t)process.exit(1);process.stdout.write(t);" | docker exec -i -e FLOW04_DISPOSABLE_RECOVERY=true -e FLOW04_AUTHENTICATED_RECOVERY=true core-backend-core-1 node -r ts-node/register -r tsconfig-paths/register test/ticket-recovery.real.ts
```

The sections below preserve earlier rollout and acceptance evidence.

## Approved ticket:work rollout

**2026-11-21.** Explicit approval covered the AR-IMMS PoC and the reviewed 12-file patch. The verified patch was applied and image `sha256:d02dc8aabbc932fcea5dba488aa8a2d9b60af5800229b96de76ede5e80d26fc0` was built and deployed. [Exact patch and approval](review/flow04-ticket-work-approval.md)

| Role | Deployed Ticket policy |
| --- | --- |
| OPERATOR | `ticket:read/create/manage/work/close`. Management and reopen retain their existing guards. Closing requires the current valid Business Owner. |
| TECHNICIAN | `ticket:read/work` for currently visible Tickets. Work covers only the three non-terminal progress transitions and internal Article creation. No management or close grant. |
| IT_ADMIN | IAM's full-catalog policy still applies. Ticket denies business access on all routes. |

- **Live HTTP PASS, Ticket 15.** Refreshed legitimate sessions authenticated as OPERATOR, TECHNICIAN and IT_ADMIN. The Operator created, replayed and assigned the fixture, updated information and links, was denied closure as non-Owner, then closed as current Owner and reopened. Technician performed NEW → OPEN → PENDING → OPEN, created one internal Article and recovered the same Article ID when replaying the operation key. Unrelated and former-assignee work attempts returned 404, including same-key Article replay after scope was lost. Technician self-assignment, Owner change, management, link updates, close and reopen returned 403. IT_ADMIN was denied all 13 Ticket operations. The existing fixture 13 also passed the three-role read and denial regression after rollout.
- **Canonical and Audit readback PASS.** Ticket 15 ended OPEN with separate Operator Owner and Technician Assignee. Zammad retained exactly two internal notes, including the creation note. Core Audit returned 14 events and attributed all three progress events and one Article creation to Technician. Ticket 3 retained its baseline values and timestamp. Ticket 11 still has its locked `dispatching` receipt without a verified result.
- **Secured deployment PASS.** The selected Zammad stack was reattached privately and Core successfully authenticated to it over the internal network. Zammad and MongoDB have no host port publication. A representative ordinary bridge client reached Core but could not reach the former host port, private proxy or maintenance route. The unrelated 8080 proxy retained its container ID, start time and bindings. Core readiness and Swagger returned 200. All 13 live Swagger permission annotations match static OpenAPI, with `ticket:work` on exactly two operations.
- **Repository regression PASS.** 728 Jest tests in 115 suites, including 372 IAM/Ticket tests in 39 suites. TypeScript, ESLint, Docker production build, IAM and Ticket OpenAPI lint, 14 Mongo mapping tests and the Mongo journal rollback/recovery/contention cases passed.

**Acceptance:** UC-69 and UC-70 now have live Technician backend evidence. UC-76 has real backend evidence for assigned work, progress, Article attribution and access loss. TC-WF04-13–15 now include actual Technician HTTP execution, while 16–17 retain actual Operator closure/reopen evidence. TC-WF04-05 and 18 still require actual client acceptance and the staged demo. The fixed 22-case inventory has not changed. Incident/Maintenance integrations and physical client acceptance remain release gates. [Acceptance inventory](../testing/flow04-test-matrix.md)

```powershell
$env:FLOW04_EXPECT_TECH_WORK='true'
$env:FLOW04_REAL_TICKET_FIXTURE_ID='13'
$env:FLOW04_DISPOSABLE_HTTP_WORKFLOW='true'
node test/ticket-api.real.cjs
```

The command creates a disposable Ticket on the selected PoC and uses fresh sessions stored in the ignored token file. The evidence below describes the earlier baseline and review.

## Previous finalization verification

The previously blocked role sessions are resolved. Operator, Technician and IT_ADMIN authenticated through the public IAM `/api/v1/auth/me` route using the provided Git-ignored access tokens. No reset, session revocation, ACL change or mapping update was needed.

| Role | Current Ticket permissions and enforcement | Proposed baseline after IAM owner approval |
| --- | --- | --- |
| OPERATOR | `ticket:read/create/manage/close`. Read in approved group, create and manage, record progress and notes, reopen under management permission. Closure still requires exact valid current Business Owner. | Add `ticket:work`. Progress and internal note guards use the narrower capability. |
| TECHNICIAN | `ticket:read` for valid owned/assigned Tickets. Progress and append return 403. | Add `ticket:work` only. Three non-terminal transitions and approved internal note append, with current resource eligibility. No management, closure or reopening grant. |
| IT_ADMIN | IAM catalog inheritance does not grant Ticket business access. Actual session denied on all 13 operations. | Same Ticket denial, including if IAM's all-catalog baseline includes the new capability. |

The permission gate described in this historical baseline was subsequently approved and verified as recorded above. [IAM and owning-module handoff](flow04-owning-module-handoff.md)

- **Actual authenticated HTTP, disposable Ticket 13 — PASS on current IAM policy.** All 13 operations exercised with the three legitimate sessions. Operator created and replayed, assigned, updated, recorded progress and added one internal note, closed as current Owner and reopened. Technician read only while related, was denied unrelated and management access and lost detail access after reassignment. Current Technician work returned 403. IT_ADMIN was denied all 13. Draft submission and non-null Incident link returned the expected 503. Article replay returned the same ID. The API returned the same empty link context and Article timeline after reopening. Public Audit returned 14 records attributed to the actual Operator, including one Article-add fact. The public Asset query returned zero fixtures, so the real link proof is empty-context preservation. Positive multi-Asset coverage remains deterministic with separate Mongo integration.
- **Bounded recovery, disposable Ticket 14 — PASS.** The runner withheld the results of actual accepted Zammad create/append operations at the integration-port boundary. Temporary absence of the matching note simulated delayed evidence. The same keys did not redispatch. The exact positive marker recovered one Ticket and one note. Injected local Audit/transaction failure rolled back context, and a fresh workflow instance finalized the verified checkpoint, without a second upstream create. Two other operations were blocked while a durable Owner-change lock was held, including close and competing assignment. After transfer, the former Owner was denied. This proves Core's concurrency boundary. It does not model a live search outage or establish Zammad compare-and-set.
- **Ticket 11 quarantine — confirmed read-only.** Canonical state remains 3 with pending time. Its `progressed` receipt is still `dispatching`, with its lock and no verified result. Current Zammad state alone cannot prove causality or recreate the missing verified checkpoint using existing procedures. No release, edit, deletion or retry was attempted.
- **Deployment regression — PASS.** Core readiness and Swagger responded. Representative ordinary bridge reached Core and failed to reach the former Zammad port, private proxy and stopped maintenance route. MongoDB and selected Zammad still have no host port publication. Live/static OpenAPI matched permissions across 13 operations and the single validated idempotency header on each of nine mutations. Existing mappings, Ticket 3, original users, volumes and shared submodule were preserved.
- **Fresh current-branch checks — PASS.** 721 Jest tests / 115 suites, 232 focused Ticket tests, 133 IAM tests, 38 fake-Zammad HTTP tests, 14 Mongo mapping tests, Mongo journal transaction and contention checks, TypeScript, lint, formatting, local and Docker production builds, and Redocly spec validation. Focused Jest counts are subsets of the full run.

### Acceptance status on the unchanged inventory

Only five backend lifecycle cases (13–17) are recorded as **PASS** here. They were executed through the real public HTTP path using an Operator bearer session and verified canonical readback. This is not a completed staged BM04 run. CI automation counts, physical-client execution and exception thresholds remain unassessed.

| TC-WF04 | Result | Evidence or missing requirement |
| --- | --- | --- |
| 01 | NOT RUN | Backend creation/readback passed on Ticket 13. Actual Web/Mobile canonical identity handoff pending. |
| 02 | BLOCKED | Reviewed Draft and Confirmed Incident owning contracts missing. 503 verified. |
| 03 | NOT RUN | Backend denied unauthorized create. Full accepted exception scenario still pending. |
| 04 | NOT RUN | Actual HTTP assignment and separate Owner verified. Client scenario pending. |
| 05 | BLOCKED | Candidate scope checks passed. Technician work awaits IAM owner, secured rollout and Mobile/Web clients. |
| 06 | NOT RUN | Authenticated Technician self-grant/reassignment and IT_ADMIN denied. Formal scenario pending. |
| 07 | NOT RUN | Real non-Owner closure denial, but DS-04b required client/demo evidence pending. |
| 08 | NOT RUN | Real Technician reopen denied. Formal scenario evidence not recorded. |
| 09 | BLOCKED | Real Ticket history/Article retention passed; actual Incident and Maintenance independence cannot run. |
| 10 | BLOCKED | No Incident/Maintenance contracts or physical-client evidence. No current live Asset fixture; deterministic positive Asset tests passed. |
| 11 | NOT RUN | Port-boundary lost-create injection passed with real Zammad. Full HTTP/fault-injection acceptance run pending. |
| 12 | NOT RUN | Verified checkpoint/Audit failure recovery passed. Full HTTP/fault-injection acceptance run pending. |
| 13 | PASS | Actual HTTP NEW → OPEN. |
| 14 | PASS | Actual HTTP OPEN → PENDING with verified pending time. |
| 15 | PASS | Actual HTTP PENDING → OPEN. |
| 16 | PASS | Actual current Business Owner closed OPEN Ticket. |
| 17 | PASS | Actual HTTP CLOSED → OPEN with same canonical Ticket. |
| 18 | BLOCKED | Technician work awaits IAM owner and secured rollout. Staging and Web/Mobile/MR acceptance have not run. |
| 19 | NOT RUN | HTTP duplicate OPEN transition rejected with 409. Formal acceptance run pending. |
| 20 | NOT RUN | Current configured identities and fail-closed regression verified. Full case execution with all mapping fault classes pending. |
| 21 | NOT RUN | Actual Core writer conflict and former-Owner denial verified; agreed full case execution pending. |
| 22 | NOT RUN | Actual same-key replay and port-boundary lost-append recovery passed. Full HTTP/fault-injection acceptance run pending. |

### Reproduction

Run the existing verification commands below and use these entry points for the two disposable data paths. Run the opt-in creation runners only on the approved private PoC.

```powershell
$env:FLOW04_REAL_TICKET_FIXTURE_ID='13'
node test/ticket-api.real.cjs
$env:FLOW04_DISPOSABLE_HTTP_WORKFLOW='true'
node test/ticket-api.real.cjs
Remove-Item Env:FLOW04_DISPOSABLE_HTTP_WORKFLOW
docker cp test/ticket-recovery.real.ts core-backend-core-1:/app/test/ticket-recovery.real.ts
docker exec -e FLOW04_DISPOSABLE_RECOVERY=true core-backend-core-1 node -r ts-node/register -r tsconfig-paths/register test/ticket-recovery.real.ts
node node_modules/jest/bin/jest.js --runInBand --testPathPatterns=src/modules/iam
```

**Integration readiness:** Clients can integrate the READY operations and currently authorized paths of the PARTIAL operations against Core. Use the [13-operation guide](flow04-ticket-api-guide.md) and avoid the fail-closed paths until owning modules are connected. **Production release:** NO-GO pending IAM activation and positive Technician HTTP, real owning contracts, staged physical-client acceptance, formal approval and unresolved operational recovery gates.


## Previous implementation evidence

The implementation-phase evidence below predates the finalization results above.

| Phase | Use cases | Implementation checklist |
| --- | --- | --- |
| P1-B.3 | UC-66 | Authenticated detail, allowlisted DTO, scoped 404, public runtime and static OpenAPI |
| P1-C | Foundation | Context and operation receipts, unique identities, atomic finalization and audit |
| P1-D | UC-63, UC-64 | Manual create and readback. Reviewed-draft dependency isolated through Ticket port |
| P2 | UC-65, UC-68 | Scoped list and responsibility updates |
| P3 | UC-67, UC-69, UC-70, UC-71 | Information, non-terminal transitions, Article append and retrieval |
| P4 | UC-74, UC-75 | Owner closure, authorized reopening, cross-instance coordination |
| P5 | UC-72, UC-73, UC-76 | Context links, Asset bridge, Incident and Maintenance gates, Mobile API reuse |
| Final | UC-63–76 | Executable evidence and separate production release status |

The current repository composes IAM, Audit and Asset Topology. No Incident reviewed-draft or Maintenance public module is composed. The existing IAM catalog grants the baseline Technician only Ticket read. Those paths require independent contracts or a permission decision.

## Delivery status

| UC | Status | Implementation and evidence |
| --- | --- | --- |
| 63 | Implemented, real backend verified | Manual creation, required valid responsibilities and priority, optional validated Assets, scoped readback, context and Audit. Disposable Ticket 12 created and replayed on the same operation key. |
| 64 | Blocked by owning contract | Ticket-side reviewed draft and confirmed Incident port. Valid/stale/missing contract cases tested. Endpoint returns 503 until Incident exposes approved access, freshness, evidence and duplicate-confirmation semantics. |
| 65 | Implemented, real backend verified | Scoped cursor list, filters and title search. Tested non-leaking pagination and actual filtered Technician read of Ticket 12. |
| 66 | Implemented, HTTP integration and real backend verified | Strict detail DTO and non-disclosing 404 through P1-B.2. Live public bearer acceptance remains blocked as described below. |
| 67 | Implemented, real backend verified | Operator title/priority only with verified readback and Audit. |
| 68 | Implemented, real backend verified | Independent responsibilities, validated targets, no self-grant. Ticket 12 confirmed. |
| 69 | Partial, permission gate | Operator transitions verified on Ticket 12. Current Technician baseline cannot submit writes. Pending uses runtime state lookup and minute resolution. |
| 70 | Partial, permission gate | Operator internal plain note append, readback, idempotency, Audit and positive recovery by exact marker. Technician baseline cannot append. |
| 71 | Implemented, real backend verified | Sanitized visible Article page. Actual Technician read of Ticket 12 using IAM application port. |
| 72 | Partial, integration gates | Operator Asset links implemented using public Asset queries. Confirmed Incident and Maintenance validation/attachment seams and deterministic tests are present. Real owning contracts are absent. |
| 73 | Partial, integration gates | Authorized links read with current reference checks. Real Incident/Maintenance portions await their owning modules. |
| 74 | Implemented, real backend verified | OPEN to CLOSED only, exact current valid Business Owner and `ticket:close`. Non-owner Operator rejected on Ticket 12. |
| 75 | Implemented, real backend verified | CLOSED to OPEN, Owner or Operator with `ticket:manage`. Same Ticket, Articles and context retained. |
| 76 | Partial, permission and client evidence gates | Assigned list, detail, Articles and link APIs reuse resource visibility. Technician progress/append gated. Actual Mobile/MR execution unavailable. |

The pinned [Flow 04 baseline](https://github.com/AR-IMMS/shared-docs/blob/294001cd9f1359bc03ced3925328454cabb3c0ea/business/04-ticket-management.md) still includes legacy IT_ADMIN statements. The later approved correction excludes that role and is enforced without changing IAM or the shared submodule. The UC assignments here use the Master Task and its accepted local scope correction.

Implementation ownership: `ticket.module.ts` composes the application behind explicit activation. `presentation/` owns strict API DTOs and projections. `application/get-authorized-ticket.ts` applies the accepted resource policy. `application/ticket-workflow.ts` handles the use cases and integration boundaries. `application/ticket-journal.ts` and `infrastructure/mongodb/mongo-ticket-journal.store.ts` implement durable receipts, verified checkpoints, per-Ticket coordination, context and Audit outbox commit. `infrastructure/zammad-ticket-workflow.adapter.ts` implements scoped REST operations. Core composition and the export of the existing public Asset lookup are the only cross-module implementation changes. See the [13-operation API catalog and examples](flow04-ticket-api-guide.md) and [OpenAPI](../../../api/v1/ticket.yaml).

## Recovery and limitations

- `ticket_operation_receipts` has a unique operation ID and a unique sparse per-Ticket lock. `ticket_business_contexts` has a unique instance/group/external Ticket key. It carries reference IDs, creator and Audit sequence, with no Zammad canonical snapshots.
- A verified checkpoint survives restart and can finish context and Audit atomically. A matching repeated request yields the same canonical reference, subject to fresh access. A permanently ambiguous operation holds its Ticket write lock. No TTL releases an uncertain write.
- If an Article append response is lost, retry with the same key and body. A single matching integration-authored note permits recovery. Ticket create needs a candidate external ID from authorized support. The optional `reconcile_ticket_id` only reconciles an existing receipt. The candidate must match the canonical creation fields, group and the exact integration-authored initial-note marker and body. A negative search, missing marker, changed canonical facts or ambiguous duplicate markers cannot confirm success. An exceptional unresolved PUT requires operational review; Core does not assert causality from a coincidental matching value or redispatch it.
- Operational lookup: under the restricted maintenance procedure, record the affected actor, operation, fixture, and incident. Confirm the journal ID and inspect the known candidate's history and internal note. Close maintenance before resuming Core. Submit the original create payload and key with the approved candidate ID. No direct DB edits, lease clearing or retry with a new key are part of normal recovery. Ticket 11 is a disposable example of a held unresolved receipt and was not reused.
- Core's durable lock serializes relevant writers across Core instances, but Zammad PUT has no verified atomic precondition against trusted maintenance, timers or automation. Core rechecks IAM, visibility and the canonical snapshot immediately before changing it. Trusted administration still requires pausing Core. Verified pending reminder has no automatic next state in the selected catalog. Review changes to triggers or role/permission caches before release.
- Article author in Zammad remains service account 6. The hidden operation marker links the note to the Core Audit human, whose identity is recorded with the canonical Article ID. The selected Agent internal plain-note route avoids the verified customer-trigger condition. Other Article types, sending email, markup rendering, attachments and attribution impersonation are excluded.
- The search index is eventually consistent. Direct detail reads are canonical. Article inventory is bounded to 2,000 returned rows and fails explicitly above the cap. This is a PoC limit. Further scalability and production client tests remain separate.

## Verified runs

- Real secured PoC preflight passed for group 2, service identity 6, active Business Owner field values, private Mongo/Zammad bindings and stopped maintenance gateway. Representative bridge could reach Core and could not reach old 8081, 8444 or the private proxy. Ready and Swagger returned 200. Public Ticket detail and list without credentials returned 401.
- Real backend run on disposable Ticket **12** passed using actual IAM application port, Mongo and Zammad. Created, replayed the key, denied unauthorized access and changes, reassigned Technician without changing Owner, changed title/priority, ran the approved lifecycle, appended and replayed a note, rejected an invalid Asset and unavailable Incident, denied non-owner closure, closed and reopened as authorized. Real read-only canonical list and filtered Technician list/Articles passed separately. Audit relay delivered 14 user-attributed records for Ticket 12. Ticket 11 exposed Zammad's minute rounding; the first Pending write committed upstream but was held unresolved, with no successful receipt. The normalization fix passed on a fresh, separate fixture.
- Mongo mapping run: 14/14. Journal replica-set integration passed transaction rollback, verified checkpoint recovery from a fresh store, context/Audit atomicity, cross-instance contention and monotonic Audit sequencing. Fake HTTP and HTTP controller integration run as part of the focused Jest suites.
- Final full Jest coverage: **721 tests / 115 suites passed**, with 76.14% line coverage. Focused Ticket run: **232 tests / 14 suites passed**. The independently selected fake-Zammad HTTP run passed **38 tests / 3 suites**. Both are subsets of full coverage.
- Repository TypeScript, non-mutating ESLint, scoped Prettier, production build, Docker image build and Redocly OpenAPI spec lint were verified. Live Swagger enumerated 13 Ticket operations and was used to verify the checked-in endpoint inventory.
- A freshly supplied admin1 bearer session authenticated through `/api/v1/auth/me`. Real HTTP checks verified all 13 business operations denied, including the detail and child-resource 404s, despite inherited Ticket capabilities. Readback after these requests confirmed Ticket 12 retained OPEN state, the same responsibilities and its two internal notes. The Ticket 3 baseline also retained its prior timestamp and assignment.
- Live HTTP using Operator/Technician bearer sessions is **BLOCKED**. Windows denied access to the credential files and their security descriptors with the current identity and from the elevated helper. The historical ACL command disabled inheritance and granted the provisioning execution identity and SYSTEM. The live owner/SID could not be verified. The only known Operator/Technician refresh tokens are inside the protected files. No other usable sessions were found in the workspace and neither role is present in the ignored token file. The original ACLs/passwords were preserved. A trusted internal application caller is separate evidence from verified HTTP sessions.
- Actual Web/Mobile/MR and staging CI, reviewed Incident, Maintenance integration and ambiguous mutations on actual Zammad are **NOT RUN** or **BLOCKED** as applicable.

```powershell
node node_modules/jest/bin/jest.js --coverage --runInBand
node node_modules/jest/bin/jest.js --runInBand --testPathPatterns=src/modules/ticket
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/modules/ticket/infrastructure/zammad-ticket-read.http-contract.spec.ts src/modules/ticket/infrastructure/zammad-ticket-workflow.http-contract.spec.ts src/modules/ticket/infrastructure/zammad-user-access.http-contract.spec.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.spec.json
node node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"
node node_modules/@nestjs/cli/bin/nest.js build
node node_modules/prettier/bin/prettier.cjs --check 'src/modules/ticket/**/*.ts' src/app/core.module.ts src/app/core.module.spec.ts src/main.ts src/platform/config/env.schema.ts src/modules/asset-topology/asset-topology.module.ts test/ticket-workflow.real.ts test/ticket-journal.integration.ts test/ticket-api.real.cjs
npx --yes @redocly/cli@2.82.0 lint --extends spec api/v1/ticket.yaml
$repo=(Get-Location).Path
docker run --rm --network arimms-p0-core-data-v1 -e 'MONGODB_TEST_URI=mongodb://mongodb:27017/ar_imms_ticket_journal_test?replicaSet=rs0&directConnection=true' --mount "type=bind,source=$repo/test,target=/app/test,readonly" --mount "type=bind,source=$repo/src,target=/app/src,readonly" --entrypoint node arimms-core-flow04:local -r ts-node/register -r tsconfig-paths/register test/ticket-journal.integration.ts
docker cp test core-backend-core-1:/app/test
# Only with an approved dedicated disposable environment, creates a fresh fixture:
docker exec -e FLOW04_DISPOSABLE_WORKFLOW=true core-backend-core-1 node -r ts-node/register -r tsconfig-paths/register test/ticket-workflow.real.ts
# Read-only regression on existing disposable fixture:
docker exec -e FLOW04_EXISTING_WORKFLOW_FIXTURE=12 core-backend-core-1 node -r ts-node/register -r tsconfig-paths/register test/ticket-workflow.real.ts
# Requires valid short-lived access tokens stored in the ignored session file:
$env:FLOW04_REAL_TICKET_FIXTURE_ID='12'
$env:FLOW04_REAL_ROLE='IT_ADMIN' # Optional: run IT_ADMIN checks alone
node test/ticket-api.real.cjs
```

The identity-mapping Mongo command is in [gate report section 9](flow04-p1b-gate-resolution.md). [Deployment runbook](../../../deploy/flow04/README.md).

## Fixed 22-case inventory and acceptance

Evidence below is backend technical evidence. The [original 22-case inventory](../testing/flow04-test-matrix.md) and its planned CI classifications remain untouched. No unavailable client or BM04 acceptance case is marked passed.

| TC-WF04 | Backend evidence | Business status |
| --- | --- | --- |
| 01 | Real dedicated manual create and same canonical readback | Pending actual Web/Mobile |
| 02 | Valid/stale reviewed-draft contract tests; missing port fails closed and maps to 503 | Blocked |
| 03 | App role/permission and HTTP validation tests; actual no-session 401 | Pending authenticated endpoint verification |
| 04 | Ticket 12 independent assignment/Owner | Pending actual clients |
| 05 | Assigned Technician can read, progress/note denied by permission | Blocked |
| 06 | Technician self-grant denied in app/HTTP contract tests; existing writer-isolation evidence | Pending authenticated endpoint verification |
| 07 | Ticket 12 non-Owner Operator closure denied; then authorized Owner close | Pending required demo |
| 08 | Technician reopen denied in real application run; unsupported state tested | Pending required HTTP scenario |
| 09 | Fixture identity, links and Articles survived reopening | Blocked for real Incident/Maintenance side-effect check |
| 10 | Multiple Asset link and owning-port tests; Mongo persistence verified | Blocked for actual Incident/Maintenance and clients |
| 11 | Journal delayed positive recovery; no automatic second dispatch | Pending real response-loss and HTTP acceptance |
| 12 | Replica-set rollback and verified checkpoint restart recovery | Pending end-to-end failure injection |
| 13 | Ticket 12 NEW to OPEN | Pending required authenticated HTTP execution |
| 14 | Ticket 12 OPEN to PENDING | Pending required authenticated HTTP execution |
| 15 | Ticket 12 PENDING to OPEN | Pending required authenticated HTTP execution |
| 16 | Ticket 12 Owner OPEN to CLOSED | Pending required authenticated HTTP execution |
| 17 | Ticket 12 authorized CLOSED to OPEN | Pending required authenticated HTTP execution |
| 18 | Actual backend workflow exists; Technician writes and physical clients outstanding | Blocked |
| 19 | Invalid status rejected in application and HTTP DTO tests | Pending agreed acceptance execution |
| 20 | IAM and mapping cases through unit, Mongo and real configured mappings | Pending agreed acceptance execution |
| 21 | Real cross-instance lock contention and canonical reread tests | Pending full concurrency scenario across accepted writers |
| 22 | Repeated Article request returned original Article on actual Zammad; ambiguous recovery journal tests | Pending real response-loss and HTTP acceptance |

No complete business acceptance run was executed. Pass rates, automation threshold and zero-open-defect release assertions remain unassessed. There are 22 tracked cases and zero claimed business passes here. Formal BM04 approval remains pending.

**Backend integration:** PoC APIs and Swagger are enabled for integration of implemented paths. Public IT_ADMIN denial passed. Public Operator/Technician acceptance still requires legitimate sessions. **Production release:** NO-GO pending actual client/role tests, Incident/Maintenance edges, permission decision, acceptance execution and formal business approval.

**One IAM policy decision:** For UC-69/70/76, decide whether to approve a narrow Technician progress/Article capability (such as `ticket:work`) limited to visible assigned/owned Tickets. Current behavior is denial with unchanged IAM. Owner closure and reopening remain subject to their separately existing capabilities. No Technician management override is needed.

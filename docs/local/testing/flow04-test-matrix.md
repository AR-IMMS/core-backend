# Flow 04 — P0 test traceability

Status: 13 backend verified, 5 partial and 4 blocked after the secured PoC run on 2026-11-21. The IDs, layer requirements and planned CI placements are unchanged. No physical Web/Mobile/MR or staged CI pass is claimed. [Current acceptance evidence](../integration/flow04-backend-completion.md#acceptance-evidence) ? [Historical P0 report](../integration/flow04-p0-zammad-verification.md).

## Sources and counting

- [Accepted Flow 04 baseline](https://github.com/AR-IMMS/shared-docs/blob/294001cd9f1359bc03ced3925328454cabb3c0ea/business/04-ticket-management.md), BR-01–12 and F4-REQ-01–10.
- Team-prepared BM04, FA26SE162 / GFA26SE138, Review 2 dated 2026-11-06, WF-04 owner Lê Trần Anh Duy. Local source: `C:\Users\Admin\Downloads\SEP490_FA26SE162_R2_BM04_Commitment.docx.pdf`; SHA-256 `6bf4922a4994bede844d399fdeba43259e14467da21af4ff90fb8a60fc039b40`.
- PDF pp. 9–10 (§6.4), pp. 15–16 (§7.3), pp. 17–18 (§8). Formal version and approval fields remain unconfirmed. Numerical commitments are known; reviewer approval is not inferred.

Keep 22 unique IDs: 12 feature + 5 transition + 1 E2E + 4 supplemental. Repeating an ID across clients, layers, or runs does not create another case. Demo IDs reference cases and add no cases. Partial fake-adapter success does not satisfy required real integration or client evidence.

BM04 minimums remain 12 feature cases (3 per group, Web/Mobile coverage), 5 transitions, 1 main-path E2E, 18 unique total, 9 CI and at least 50% of finalized total. With 22 committed cases the automation floor is **11**, not 9. Plan 17 CI cases (16 PR + 1 staging); completed Flow 04 CI executions: **0**. Preserve at least 7 feature cases automated. Main paths must all pass; exceptions and overall WF-04 pass rates must each reach 90%; zero open Critical/High defects; seeded staging E2E required. At 22 cases, overall threshold requires at least 20 passes, without waiving mandatory main paths or silently excluding blocked cases.

Project commitments remain 5 workflows, 5 main/5 exception demos, at least 84 unique cases plus pending WF-02/03 transitions, and at least 45 baseline CI cases adjusted to 50% of finalized total. The 22 WF-04 IDs enter that inventory once. WF-04 uses its stricter 90% exception threshold, not the project-wide 80% demo floor.

## Execution layers

| Layer | What it establishes | Required environment |
| --- | --- | --- |
| U — Unit | Pure policy and orchestration behavior with port fakes | Jest |
| H — HTTP integration | Nest guards, validation, envelope/errors, resource checks | Nest/Supertest; dedicated Mongo where applicable |
| F — fake-Zammad contract | HTTP payload parsing, error handling and deterministic injected faults | Local fake HTTP server; Mongo for receipts |
| R — real-Zammad contract | Actual selected version, account, fields, permissions and mutation behavior | Authorized disposable Zammad, credentials, seeded identities |
| E — Web/Mobile E2E | Actual clients → Core → Zammad → cross-client results | Web and Mobile harnesses, Core/IAM, Mongo, Zammad, seeded staging |

Existing backend `test:e2e` suites are not Web/Mobile E2E. R and E remain dependent on their actual environments. P0 direct REST probes do not test future Core guards or replace these cases.

## Unique inventory

The final column records current backend evidence and incomplete scenarios. PR and staging entries remain intended CI placements. Backend verification does not waive client and staging requirements.

| ID (TC-WF04-) | Group / requirement | Acceptance focus | Layers | Planned CI | Current disposition |
| --- | --- | --- | --- | --- | --- |
| 01 | F4-01 / REQ-01,08 | Authorized manual creation without Incident; same canonical ID on Web/Mobile | U,H,F,R,E | PR | Partial |
| 02 | F4-01 / REQ-02 | Reviewed confirmed Incident draft; explicit authorized creation only | U,H,F,R,E; blocked Incident contract | Pending | Blocked |
| 03 | F4-01 / REQ-01 | Unauthorized creation has no external/local business side effects | U,H | PR | Backend verified |
| 04 | F4-02 / REQ-04 | Assign/reassign while preserving distinct Business Owner accountability | U,H,F,R,E | PR | Partial |
| 05 | F4-02 / REQ-04,08 | Assigned Technician progress/Article from Mobile visible on Web; trace original actor | H,F,R,E | PR | Partial |
| 06 | F4-02 / REQ-04 | Unauthorized reassignment/management rejected | U,H | PR | Backend verified |
| 07 | F4-03 / REQ-05 | Non-Owner closure rejected even with close permission; Zammad unchanged (DS-04b) | U,H,R,E | PR | Partial |
| 08 | F4-03 / REQ-06 | Unauthorized reopening rejected | U,H,R | Pending | Backend verified |
| 09 | F4-03 / REQ-03,06,10 | History retained; Ticket changes do not mutate other domain lifecycles | U,H,R; full composition needs other modules | Pending | Blocked |
| 10 | F4-04 / REQ-07,08 | Zero/one primary Incident, multiple Assets/Maintenance links, shared client context | U,H,Mongo,E; approved public contracts required | Pending | Blocked |
| 11 | F4-04 / REQ-09 | Accepted create, lost response: reconcile same submission without false success or duplicate | H,F,R,Mongo | PR | Backend verified |
| 12 | F4-04 / REQ-09 | External success then local context/audit failure: recover same external ID | H,F,R,Mongo | Pending | Backend verified |
| 13 | F4-03 / REQ-03 | NEW → OPEN | U,H,R | PR | Backend verified |
| 14 | F4-03 / REQ-03 | OPEN → PENDING | U,H,R | PR | Backend verified |
| 15 | F4-03 / REQ-03 | PENDING → OPEN | U,H,R | PR | Backend verified |
| 16 | F4-03 / REQ-05 | OPEN → CLOSED by authorized current Owner | U,H,R | PR | Backend verified |
| 17 | F4-03 / REQ-06 | CLOSED → OPEN by authorized actor | U,H,R | PR | Backend verified |
| 18 | F4-01..04 / DS-04a | Web create → assign → Mobile view/progress/Article → Owner close via Core | E | Staging | Blocked |
| 19 | Supplemental F4-03 | Unsupported transition rejected without mutation | U,H,F | PR | Backend verified |
| 20 | Supplemental F4-01,02 | Missing/ambiguous/inactive/wrong-group identity fails closed | U,H,R | PR | Partial |
| 21 | Supplemental F4-03 | Concurrent ownership change cannot authorize stale Owner closure under approved writer model | F,R,H | PR | Backend verified |
| 22 | Supplemental F4-02,04 | Article accepted then response lost: no blind duplicate append or false success | F,R,H | PR | Backend verified |

DS-04b references 07, 11 and 22; test both unauthorized closure and ambiguous external outcomes. Feature-group cases must include client evidence, not simply label backend calls “Mobile.” Define main/exception classification before execution; report numerator, denominator, blocked/not-run IDs and defects. Archive commit, test command, environment/version, seed identifiers, sanitized result, CI run link and artifact for each execution.

## CI coverage by original case

The PR jobs schedule deterministic coverage for **21 of the 22 IDs**, of which **3 cases are fully automated at their required layers** (03, 06, 19, including two Feature cases). The other 18 are partial in PR; TC-WF04-18 is staging-only. The committed minimum of 11 complete cases and 7 Feature cases is therefore **not met**. Required real-Zammad, physical-client and owning-module environments cannot be waived. The original planned 16 PR and one staging placements remain unchanged. Actual GitHub job results: **NOT RUN**. The latest secured-PoC evidence (fixtures 16 and 17) remains separate from fresh local PR-equivalent results.

In the table, **Contracts** means `wf04-contracts` and the repository-wide coverage job, and **Mongo** means `wf04-mongo`. File shortcuts refer to these executable paths:

- **Workflow**: [ticket-workflow.spec.ts](../../../src/modules/ticket/application/ticket-workflow.spec.ts); **HTTP**: [ticket-http.integration.spec.ts](../../../src/modules/ticket/presentation/ticket-http.integration.spec.ts).
- **Zammad**: [workflow adapter HTTP](../../../src/modules/ticket/infrastructure/zammad-ticket-workflow.http-contract.spec.ts), [read adapter HTTP](../../../src/modules/ticket/infrastructure/zammad-ticket-read.http-contract.spec.ts), [eligibility HTTP](../../../src/modules/ticket/infrastructure/zammad-user-access.http-contract.spec.ts).
- **Auth**: [get-authorized-ticket.spec.ts](../../../src/modules/ticket/application/get-authorized-ticket.spec.ts) and existing IAM guard/permission suites.
- **Receipt**: [ticket-journal.spec.ts](../../../src/modules/ticket/application/ticket-journal.spec.ts); **Mongo mapping/journal**: [mapping](../../../test/ticket-identity-mapping.integration.ts) and [journal](../../../test/ticket-journal.integration.ts).
- **Live**: [three-role HTTP](../../../test/ticket-api.real.cjs) and [port-fault plus live HTTP recovery](../../../test/ticket-recovery.real.ts). These are opt-in and excluded from PR. [Execution and fixture runbook](flow04-ci-runbook.md)

| Case (TC-WF04-) | Required layers | Executable coverage | CI job and local result | Remaining gap / environment |
| --- | --- | --- | --- | --- |
| 01 | U,H,F,R,E | Workflow, HTTP, Zammad create payload; Live full backend create/read | Contracts PASS, partial | Actual Web/Mobile shared ID on seeded client environment |
| 02 | U,H,F,R,E | Workflow tests draft freshness and missing provider; Live 503 | Contracts PASS, partial | Incident owner, real Zammad and clients with reviewed Incident |
| 03 | U,H | Workflow and HTTP `TC-WF04-03`; no workflow dispatch/journal; Live negative | Contracts PASS, complete | No extra real or client test required by this row |
| 04 | U,H,F,R,E | Workflow responsibility invariants, HTTP guard/shape, Zammad scope; Live assignment | Contracts PASS, partial | Cross-client view and reassignment |
| 05 | H,F,R,E | HTTP work policy, fake Article response faults, Workflow scope; Live Technician and Audit | Contracts PASS, partial | Actual Mobile submission visible on Web |
| 06 | U,H | Workflow and HTTP `TC-WF04-06` guard/denial; Live negative | Contracts PASS, complete | No extra real or client test required by this row |
| 07 | U,H,R,E | Workflow Owner check and HTTP close permission; Live non-Owner unchanged | Contracts PASS, partial | Actual client/demo DS-04b |
| 08 | U,H,R | Workflow and HTTP `TC-WF04-08` deny unauthorized reopen; Live 403 unchanged | Contracts PASS, partial | Real Zammad verification is opt-in |
| 09 | U,H,R | Workflow and HTTP lifecycle boundaries; Live Ticket history preserved | Contracts PASS, partial | Real Incident/Maintenance providers and both lifecycle readbacks |
| 10 | U,H,Mongo,E | Workflow multiple Assets and owning-port doubles; Mongo journal persists multiple links; Live empty context | Contracts/Mongo PASS, partial | Real authorized Asset fixtures, both owning providers and Web/Mobile |
| 11 | H,F,R,Mongo | HTTP unresolved 409, fake transport failures, Receipt recovery and Mongo; Live same-key create recovery | Contracts/Mongo PASS, partial | Real lost-create verification is opt-in |
| 12 | H,F,R,Mongo | HTTP unresolved 409, Receipt verified checkpoint, real Mongo rollback/recovery; Live injected local failure | Contracts/Mongo PASS, partial | Real Zammad/local-failure composition is opt-in |
| 13 | U,H,R | Workflow NEW→OPEN and HTTP progress guard/DTO; Live Technician | Contracts PASS, partial | Automate real PoC/staging as a separately approved run |
| 14 | U,H,R | Workflow OPEN→PENDING and HTTP progress guard/DTO; Live Technician | Contracts PASS, partial | Real Zammad pending-time outcome is opt-in |
| 15 | U,H,R | Workflow PENDING→OPEN and HTTP progress guard/DTO; Live Technician | Contracts PASS, partial | Real Zammad progress/readback is opt-in |
| 16 | U,H,R | Workflow exact Owner close, HTTP close guard; Live OPEN→CLOSED | Contracts PASS, partial | Real Zammad close is opt-in |
| 17 | U,H,R | Workflow authorized reopen, HTTP reopen guard; Live CLOSED→OPEN | Contracts PASS, partial | Real Zammad reopen/history is opt-in |
| 18 | E | Live backend sequence only; no physical-client harness | Staging NOT RUN | Seeded Web/Mobile/MR, providers and device evidence |
| 19 | U,H,F | Workflow repeated OPEN, HTTP rejects CLOSED DTO, fake HTTP state catalog with no mutation | Contracts PASS, complete | No extra real or client test required by this row |
| 20 | U,H,R | Auth, Workflow mapping denies, HTTP concealment, Zammad eligibility and Mongo; Live configured scopes | Contracts/Mongo PASS, partial | Dedicated missing/ambiguous/inactive/wrong-group live mapping fixtures; preserve current mappings |
| 21 | F,R,H | Receipt contention and Mongo lock; Live held-lock actual HTTP and former Owner deny | Contracts/Mongo PASS, partial | Real Zammad owner race stays in opt-in pipeline |
| 22 | F,R,H | Fake Article timeout/connection loss and wrong Ticket payload, Receipt and HTTP unresolved; Live same-key single Article | Contracts PASS, partial | Actual Zammad append/recovery is opt-in |

## Reproduce the configured checks

Use the pinned install and deterministic commands in the [CI and real integration runbook](flow04-ci-runbook.md). The isolated Mongo script constructs its own database URI and does not use the existing local Mongo or secured PoC network. Flows requiring real Zammad or physical clients do not run on PR. For the latest actual release-gate evidence, see the [completion report](../integration/flow04-backend-completion.md).

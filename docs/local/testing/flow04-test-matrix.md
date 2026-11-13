# Flow 04 — P0 test traceability

Status: planned implementation tests; P0 probes are separate evidence. No Flow 04 implementation test or CI automation is claimed complete. See the [P0 report](../integration/flow04-p0-zammad-verification.md).

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

All rows are **planned / not executed as implementation acceptance cases**. PR and staging entries below are intended CI placement, not completed automation.

| ID (TC-WF04-) | Group / requirement | Acceptance focus | Layers | Planned CI |
| --- | --- | --- | --- | --- |
| 01 | F4-01 / REQ-01,08 | Authorized manual creation without Incident; same canonical ID on Web/Mobile | U,H,F,R,E | PR |
| 02 | F4-01 / REQ-02 | Reviewed confirmed Incident draft; explicit authorized creation only | U,H,F,R,E; blocked Incident contract | Pending |
| 03 | F4-01 / REQ-01 | Unauthorized creation has no external/local business side effects | U,H | PR |
| 04 | F4-02 / REQ-04 | Assign/reassign while preserving distinct Business Owner accountability | U,H,F,R,E | PR |
| 05 | F4-02 / REQ-04,08 | Assigned Technician progress/Article from Mobile visible on Web; trace original actor | H,F,R,E | PR |
| 06 | F4-02 / REQ-04 | Unauthorized reassignment/management rejected | U,H | PR |
| 07 | F4-03 / REQ-05 | Non-Owner closure rejected even with close permission; Zammad unchanged (DS-04b) | U,H,R,E | PR |
| 08 | F4-03 / REQ-06 | Unauthorized reopening rejected | U,H,R | Pending |
| 09 | F4-03 / REQ-03,06,10 | History retained; Ticket changes do not mutate other domain lifecycles | U,H,R; full composition needs other modules | Pending |
| 10 | F4-04 / REQ-07,08 | Zero/one primary Incident, multiple Assets/Maintenance links, shared client context | U,H,Mongo,E; approved public contracts required | Pending |
| 11 | F4-04 / REQ-09 | Accepted create, lost response: reconcile same submission without false success or duplicate | H,F,R,Mongo | PR |
| 12 | F4-04 / REQ-09 | External success then local context/audit failure: recover same external ID | H,F,R,Mongo | Pending |
| 13 | F4-03 / REQ-03 | NEW → OPEN | U,H,R | PR |
| 14 | F4-03 / REQ-03 | OPEN → PENDING | U,H,R | PR |
| 15 | F4-03 / REQ-03 | PENDING → OPEN | U,H,R | PR |
| 16 | F4-03 / REQ-05 | OPEN → CLOSED by authorized current Owner | U,H,R | PR |
| 17 | F4-03 / REQ-06 | CLOSED → OPEN by authorized actor | U,H,R | PR |
| 18 | F4-01..04 / DS-04a | Web create → assign → Mobile view/progress/Article → Owner close via Core | E | Staging |
| 19 | Supplemental F4-03 | Unsupported transition rejected without mutation | U,H,F | PR |
| 20 | Supplemental F4-01,02 | Missing/ambiguous/inactive/wrong-group identity fails closed | U,H,R | PR |
| 21 | Supplemental F4-03 | Concurrent ownership change cannot authorize stale Owner closure under approved writer model | F,R,H | PR |
| 22 | Supplemental F4-02,04 | Article accepted then response lost: no blind duplicate append or false success | F,R,H | PR |

DS-04b references 07, 11 and 22; test both unauthorized closure and ambiguous external outcomes. Feature-group cases must include client evidence, not simply label backend calls “Mobile.” Define main/exception classification before execution; report numerator, denominator, blocked/not-run IDs and defects. Archive commit, test command, environment/version, seed identifiers, sanitized result, CI run link and artifact for each execution.

## Existing repository commands (PowerShell)

These are instructions for later execution, not results of this documentation task. Use pinned Node 22.22.3 and pnpm 11.9.0. `pnpm.cmd` avoids the local PowerShell shim restriction.

```powershell
Set-Location 'C:\Users\Admin\AR-IMMS backend\core-backend'
pnpm.cmd install --frozen-lockfile
pnpm.cmd test --runInBand
pnpm.cmd test:cov --runInBand
pnpm.cmd typecheck
pnpm.cmd check:all
pnpm.cmd format:check
pnpm.cmd exec eslint "{src,apps,libs,test}/**/*.ts"
pnpm.cmd build
```

Existing Mongo-backed integration runs require a disposable database (these suites may drop it):

```powershell
docker compose up -d --wait mongodb
$env:MONGODB_TEST_URI = 'mongodb://localhost:27017/ar_imms_core_test?replicaSet=rs0'
pnpm.cmd test:e2e --runInBand
pnpm.cmd asset-topology:integration
pnpm.cmd asset-topology:assets:integration
pnpm.cmd asset-topology:placements:integration
```

Sources: [package.json](../../../package.json), [Jest config](../../../jest.config.ts), [backend E2E config](../../../test/jest-e2e.json), [Mongo guard](../../../test/mongodb-test-config.ts), [current CI](../../../.github/workflows/ci.yml). There is no existing Ticket real-contract or Web/Mobile E2E command. Add and document exact paths/commands with their future PRs; do not present nonexistent runners as runnable. Ordinary Jest matches `*.spec.ts`, including HTTP specs; explicit real-service suites must be isolated from normal PR runs.

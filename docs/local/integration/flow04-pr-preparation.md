# WF-04 pull request preparation

Prepared 2026-11-21 for `feat/ticket-management` → `dev`. This draft describes the current working tree. Review, commit selection and reconciliation with `dev` are still required.

## Draft pull request description

**Title** — Implement WF-04 Ticket backend and secured integration verification

### What ships

- Thirteen Core Ticket operations for manual creation, scoped reads, assignment, progress, internal Articles, links, Owner-only closure and authorized reopening. Zammad is canonical for Tickets. Core owns authorization, identity binding, business links, Audit and the operation journal.
- The approved IAM permission `ticket:work` allows Operator and Technician non-terminal progress and internal Articles. Operators retain existing management privileges. Technicians remain scoped to current responsibility. IT_ADMIN is excluded from Ticket business operations.
- Secured PoC configuration keeps Core as the ordinary writer, with MongoDB and Zammad on separate private networks and tightly controlled administrative maintenance. PR checks use hosted runners, fake Zammad and an isolated disposable Mongo replica set.
- Static OpenAPI and the client guide cover all 13 operations and stable `Idempotency-Key` handling. UC-64 and provider-dependent parts of UC-72/73 remain fail-closed. The Asset query seam supports only Asset references.

[API guide](flow04-ticket-api-guide.md) · [Secured PoC rollout and acceptance](flow04-backend-completion.md) · [Incident and Maintenance provider handoff](flow04-owning-module-handoff.md) · [IAM scope and approval](review/flow04-ticket-work-approval.md)

### Verification and reviewer notes

The local replay ran the shell commands extracted from the current workflow YAML with pinned Node 22.22.3 and pnpm 11.9.0. The two initial local jobs shared one install directory and hit a Windows package-linking race. Separate disposable checkouts resolved that local setup problem and matched the hosted jobs' checkout separation.

| Check | Fresh local result |
| --- | --- |
| Frozen pnpm install | PASS in both independent checkouts |
| Full Jest with coverage | PASS, 739 tests in 115 suites, LCOV generated |
| Focused Ticket/IAM and fake HTTP | PASS, 383 tests in 39 suites, sanitized report generated |
| MongoDB 8 disposable replica set | PASS, 14 identity cases and journal checkpoint rollback, restart recovery, transaction atomicity, cross-instance lock and Audit sequence coverage. Container and network cleanup confirmed. |
| TypeScript, ESLint, production build, frozen dependency audit | PASS |
| Ticket/IAM OpenAPI and scoped Prettier | PASS |

The replay ran on Windows with Git Bash and on Linux Docker for the isolated Mongo job. GitHub-hosted workflow actions still require their first actual run.

Historical secured-PoC runs used real authenticated Operator, Technician and IT_ADMIN sessions, canonical readback and disposable Tickets. This readiness review did not send live Ticket mutations. GitHub Actions and physical-client staging remain **NOT RUN**. See the evidence matrix below and the [exact workflow commands and fixture runbook](../testing/flow04-ci-runbook.md).

If rollout must be halted, pause Ticket traffic and use the reviewed secure rollback path. Preserve canonical Tickets, mappings, operation receipts, Audit and Mongo volumes. Keep Zammad private and leave Ticket 11 quarantined. Reconcile operations with known evidence and their original keys before resuming. Any release rollback involving the approved IAM permission requires IAM owner review and coordinated Core/OpenAPI compatibility checks. [Deployment rollback procedure](../../../deploy/flow04/README.md#rollback-without-data-loss)

## Branch and file review

Remote `HEAD` points to `refs/heads/dev`, GitHub reports `dev` at `9420437`, and no remote `develop` branch was advertised. Feature HEAD is `69ddcff`, also the remote feature tip. `dev` is 29 commits ahead of the common base and the committed feature tip adds one documentation commit. The existing `pull_request` trigger targets `[main, dev]`, so no trigger edit was needed.

Git's isolated dry merge of the pending candidate reported two content conflicts. The upstream Core composition test now lives at `src/app/__tests__/core.module.spec.ts`. Reconcile the Ticket composition assertions with the upstream reorganized test. In `src/modules/asset-topology/asset-topology.module.ts`, reconcile the Ticket Asset query export with upstream Asset retirement and search wiring. Review the auto-merged application, IAM/OpenAPI and package/config files for semantic compatibility and run CI on the reconciled tree. This review made no integration merge and did not change either implementation.

| Category | Pending files or paths |
| --- | --- |
| Ticket implementation | `src/modules/ticket/` domain, application, adapters and controllers, Core composition in `src/app/core.module.ts`, bootstrap in `src/main.ts`, Zammad config in `src/platform/config/env.schema.ts`, public Asset query export in `src/modules/asset-topology/asset-topology.module.ts`, and `api/v1/ticket.yaml`. |
| IAM permission | `src/modules/iam/domain/permission-catalog.ts`, `role-permissions.ts`, `src/modules/iam/application/user-administration.service.ts` and `api/v1/iam.yaml`. |
| CI and dependency configuration | `.github/workflows/ci.yml`, `package.json`, `pnpm-lock.yaml`, `test/wf04-ci-mongo.cjs`. Review the existing empty `auditConfig` entry in `pnpm-workspace.yaml` separately when selecting files. |
| Tests | Core module, IAM domain and persistence specs, colocated Ticket unit/controller/fake HTTP specs, `test/ticket-*.integration.ts`, `test/ticket-*.real.*`, and `test/zammad-user-access.real.ts`. |
| Documentation | Root, Ticket and events READMEs, the Flow 04 architecture, integration/approval documents, test matrix and CI runbook. |
| Deployment support | `.dockerignore`, `.env.example`, `compose.yaml`, `compose.host-dev.yaml`, and the private PoC Compose files, Dockerfile, gateway and scripts under `deploy/flow04/`. |

PR CI runs on GitHub-hosted `ubuntu-latest` with read-only repository permissions, no workflow secret inputs for Ticket tests and no route or network attachment to developer PoC services. The Mongo runner constructs its own test URI, attaches only to a unique internal Docker network, publishes no ports, mounts only source and tests, and removes only its own container and network. The local replay used copies of tracked and visible untracked files, excluded ignored session files and submodules, and cleared Core/Zammad/Mongo settings from the child process environment. The opt-in real workflow is outside PR CI. GitHub-hosted checks and the GitHub secret scan still require an actual PR run.

## Acceptance evidence by original ID

The PR column describes automation exercised locally, with no GitHub run recorded. The PoC column summarizes earlier verified evidence. Staged acceptance is **NOT RUN** for every row. Additional client or fixture requirements appear in the last column. [Original definitions, execution layers and test-file traceability](../testing/flow04-test-matrix.md#ci-coverage-by-original-case)

| TC-WF04 | PR automation | Historical real PoC evidence | Remaining acceptance |
| --- | --- | --- | --- |
| 01 | Partial | Manual create/replay and canonical readback | Same Ticket on Web and Mobile. |
| 02 | Partial | Required fail-closed 503 | Reviewed Confirmed Incident draft, current revision and evidence, duplicate prevention, and client flow. |
| 03 | Full | Unauthorized create denied with no receipt or visible Ticket | Required unit and HTTP layers covered. |
| 04 | Partial | Assignment and reassignment with separate Owner | Web/Mobile canonical responsibility readback and access loss. |
| 05 | Partial | Technician progress and Article with Audit attribution | Mobile write reflected on Web for the same Ticket. |
| 06 | Full | Technician self-grant and IT_ADMIN management denied | Required unit and HTTP layers covered. |
| 07 | Partial | Non-Owner close denied, canonical state and history unchanged | Staged DS-04b unauthorized closure. |
| 08 | Partial | Unauthorized reopen denied, state remained CLOSED | Repeatable opt-in real contract execution. |
| 09 | Partial | Ticket lifecycle/history readback | Show independent Incident and Maintenance lifecycle behavior with real providers. |
| 10 | Partial | Empty link context preserved | Populated authorized Incident, Assets and Maintenance links across actual clients. |
| 11 | Partial | Lost create response recovered on the same operation key and Ticket ID | Real recovery in the opted-in staging path, with exact cardinality. |
| 12 | Partial | Verified external ID survived injected local context/Audit failure | Real checkpoint recovery in the opted-in staging path. |
| 13 | Partial | Technician NEW → OPEN | Real contract in opted-in staging. |
| 14 | Partial | Technician OPEN → PENDING | Real contract with pending deadline readback. |
| 15 | Partial | Technician PENDING → OPEN | Real contract with canonical state readback. |
| 16 | Partial | Current Owner OPEN → CLOSED | Real contract with Owner, outcome and Audit verification. |
| 17 | Partial | Authorized CLOSED → OPEN with unchanged ID | Real contract with history and links preserved. |
| 18 | Staging only | Backend sequence exists | Seeded DS-04a Web → Mobile → Owner closure on actual clients. |
| 19 | Full | Repeated OPEN and terminal update through progress rejected | Required unit, HTTP and fake-contract layers covered. |
| 20 | Partial | Current mappings and resource scope verified | Approved isolated missing, revoked, inactive, ambiguous and wrong-group identity fixture matrix. |
| 21 | Partial | Held transfer blocked competing closure; former Owner denied after transfer | Opted-in Zammad contention and stale Owner readback. |
| 22 | Partial | Lost Article response recovered with one matching canonical note | Opted-in real same-key Article recovery and Audit attribution. |

Three complete cases (03, 06 and 19, including two Feature cases), 18 partial and one staging-only. The smallest deterministic follow-up is a composed HTTP test using the existing fake-Zammad and journal harness for TC-WF04-11 or 22. Simulate upstream commit followed by response loss, assert unresolved HTTP behavior, then replay the same key and verify exactly one fake upstream record and one Audit outcome. This connects already tested components and leaves the case partial until its real layer is executed by automation. The smallest real follow-up is to retain a sanitized, case-tagged run of the existing opt-in workflow on an approved isolated staging seed for 08 and 13–17, then the recovery runner for 11, 12, 21 and 22. These backend cases cannot satisfy the seven-Feature automation commitment by themselves.

## Staged acceptance gates

1. **Environment** — Record the reconciled candidate SHA and versions. Provision a separate secured staging Core with healthy Mongo replica set and private Zammad. Validate Core-only ordinary writer access and separately restricted maintenance. Use staged IAM sessions and scoped eligibility/mappings for Operator, Technician and an unrelated Technician, plus an unmapped IT_ADMIN for negative testing. Supply synthetic negative mapping fixtures through the approved authority with no IAM grants or PoC changes.
2. **Seed owned data** — Asset supplies two distinct authorized Asset IDs and an unauthorized example. Incident supplies a visible Confirmed Incident, approved evidence, current and stale reviewed revisions, and an atomic claim/recovery contract. Maintenance supplies active, historical, inaccessible and wrong-Ticket Activities through its public provider. Record fixture and operation IDs, ownership, revision, expected state and expiry.
3. **Real backend and recovery** — Run read-only role and topology checks before approving bounded writes. Prove lifecycle transitions, Audit actors, assignment and loss of responsibility, stale Owner denial, and error/recovery with the original key. Verify unchanged canonical state and cardinality after denied or ambiguous writes. Retain unresolved receipts and keep historical fixtures outside write scope.
4. **Actual clients** — Web creates and assigns, Mobile reads/progresses/appends, Web reads the resulting Article, and the current Owner closes the same Ticket through Core. Run denied close and ambiguous response recovery for DS-04b. Record distinct Web and Mobile run evidence and MR integration when used. Include denied scope after reassignment, populated links, and preserved history after reopen. No client calls Zammad directly.
5. **Record acceptance** — Save sanitized results keyed by case ID, commit/build and fixture, including the CI artifact or device/run reference. Require every mandatory main path, at least 90% of WF-04 exceptions and 20 of 22 overall, zero Critical/High defects, the 11-case and seven-Feature automation commitments, and confirmed formal BM04 approval/version. The production decision remains NO-GO until the remaining release evidence is reviewed.

[Execution, cleanup and staging enablement](../testing/flow04-ci-runbook.md#staging-activation-gate)

# WF-04 CI, PoC and staging verification

Use Node 22.22.3 and pnpm 11.9.0. [CI workflow](../../../.github/workflows/ci.yml) · [22-case traceability](flow04-test-matrix.md#ci-coverage-by-original-case) · [Client API guide](../integration/flow04-ticket-api-guide.md)

| Level | Entry point | Boundary |
| --- | --- | --- |
| PR deterministic | `quality`, `wf04-contracts`, `wf04-mongo` on GitHub Actions | No Core IAM credentials, no real Zammad or persistent PoC. Fake upstream binds loopback in the test process. |
| Authorized PoC | `deploy/flow04/verify-real.ps1` with explicit `poc` and mode | Named private Zammad/Mongo networks and selected Core 8082. Existing legitimate bearer sessions. No routine PR execution. |
| Seeded staging | Owner-approved isolated staging runner and client build | **NOT RUN and unavailable in this checkout**. The wrapper rejects `staging` before credential or network access. |

## Run the PR checks locally

Use `pnpm.cmd` in Windows PowerShell if using the cmd shim. Run from the repository root. These commands apply to the PR test environment, separate from the persistent PoC.

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd exec tsc --noEmit -p tsconfig.spec.json
pnpm.cmd exec eslint "{src,apps,libs,test}/**/*.ts"
pnpm.cmd test:cov --runInBand
pnpm.cmd build
pnpm.cmd audit --ignore-unfixable --audit-level moderate
pnpm.cmd exec jest --ci --runInBand --testPathPatterns=src/modules/ticket/ --testPathPatterns=src/modules/iam/
pnpm.cmd exec jest --ci --runInBand --testPathPatterns=ticket-http.integration.spec.ts --testPathPatterns=zammad-.*http-contract.spec.ts
pnpm.cmd exec redocly lint --extends spec api/v1/ticket.yaml api/v1/iam.yaml
pnpm.cmd exec prettier --check 'src/modules/ticket/**/*.ts' 'test/ticket-*.ts' test/ticket-api.real.cjs test/wf04-ci-mongo.cjs
docker pull mongo:8.0
node test/wf04-ci-mongo.cjs --build
```

The Mongo script builds an independent image from an allowlist, then starts a uniquely named single-node replica set with **no published ports** on an internal Docker network. Its data directories are tmpfs. Only `src/` and `test/` are mounted into the test container, read-only. Each suite uses a distinct generated `wf04_ci_*_test` database and the URI is constructed internally using alias `mongo`. Caller URI, credentials, repository `.tmp`, Docker socket and unrelated service routes are unavailable to the test container. The script removes only containers and networks that it created. It never removes volumes or drops persistent databases. A canceled local run may require removing the named test network/container shown in the output, after confirming their `wf04-ci-` ownership.

Normal console output holds diagnostics and Mongo emits TAP test records. CI stores filtered Jest test names/status/counts and LCOV coverage. It does not upload raw Jest messages, environments or database contents. The workflow is configured for PRs to main/dev. A local equivalent PASS does not establish a GitHub Actions PASS.

## Opt-in actual PoC

The wrapper verifies the expected private Docker networks, no host ports on Mongo/Zammad, a stopped maintenance gateway and the health of the authorized Core instance. Its work/recovery modes create new fixtures and retain them by default. Never run work mode with a token for production. Use only the approved local PoC fixture users and an ignored token file containing `CORE_OPERATOR_TOKEN`, `CORE_TECHNICIAN_TOKEN`, and `CORE_ADMIN_TOKEN`. The runner validates role and ID before creating; recovery sends the token on stdin only.

```powershell
& .\deploy\flow04\verify-real.ps1 -Environment poc -Mode Read -Fixture 16
& .\deploy\flow04\verify-real.ps1 -Environment poc -Mode Workflow -Fixture 16
& .\deploy\flow04\verify-real.ps1 -Environment poc -Mode Recovery
```

Use Read on an existing dedicated fixture. The full workflow uses the canonical ID of a newly created disposable Ticket. Recovery intentionally injects response loss, then retries the original operation key. Do not restart an interrupted operation with a new key. Retain the printed fixture ID and use authorized recovery if needed. Ticket 3 and quarantined Ticket 11 are outside write scope. Do not change mappings, credentials or either Zammad stack to run these checks.

## Fixture manifest and cleanup

| Fixture | PR setup | Approved real or staging setup |
| --- | --- | --- |
| OPERATOR | Active IAM fixture with baseline role | Use the declared immutable PoC Operator ID, valid one-to-one mapping and current eligible Zammad role. Stage must obtain separate dedicated Operator through IAM owner. |
| TECHNICIAN | Active work-only IAM fixture with valid mapping | Use declared PoC Technician. Stage needs dedicated work-only Technician with active binding and correct group. |
| IT_ADMIN | IAM baseline plus Ticket business-role rejection | Use declared PoC IT_ADMIN session. Stage needs its own IAM IT_ADMIN; no extra grants or Zammad bypass. |
| Business Owner and Assignee | Independently varied role and external-ID fixtures | Create via Core with separate Owner/Assignee fields, then change only the Assignee through the Operator API. |
| Unrelated Technician | Actor has active mapping without Ticket responsibility | Make the declared Technician unrelated by assigning a disposable Ticket to another valid user. After reassignment away, recheck scope. A full bad-mapping live matrix needs separate, approved staging fixtures and must not alter active PoC mappings. |
| Valid Asset | Authoritative Asset test double with stable UUID and available status | Asset owner supplies a dedicated registered Asset UUID via its public provisioning contract. The last PoC acceptance did not have a live Asset fixture. |
| Manual Ticket without Incident | Journal and fake upstream payload fixtures | Create with Operator, omit Incident ID, keep operation key and canonical ID. |
| Multiple Asset links | Use two distinct valid Asset UUIDs in existing Ticket application tests | Asset owner seeds two distinct authorized IDs. Operator submits both through Core link PATCH and verifies readback, replacement and preservation after reopen. |
| Confirmed Incident and reviewed draft | Separate validating test doubles, never presented as live integration | Requires owned public lookup, reviewed draft revision/evidence and atomic claim/confirmation. Supply current/ineligible revisions and actor scope. |
| Maintenance Activity | Separate reference and authorization doubles | Requires owned Activity validation and authorized canonical Ticket reference. Seed valid, inaccessible and wrong-Ticket references and a historical case. |

Local disposable Tickets are retained, visibly titled as test data, and recorded by ID. There is no automatic purge. For staging cleanup use an owning team's approved disposal process restricted to the recorded seed namespace and operation receipts. Leave an unresolved external write quarantined. Do not delete a database, drop a Docker volume, or touch historical fixtures. If the owning contract does not provide cleanup, keep the disposable records until approval.

## Staging activation gate

Enable a separate manual staging runner only after the owning teams supply an explicit allowlisted Core origin/network, the secure Zammad integration identity, an isolated fixture namespace, staged IAM sessions, provider contracts, and actual Web/Mobile/MR builds. Seed a reviewed Confirmed Incident, valid Maintenance Activity and Asset references using their own contracts. Stage should run DS-04a (TC-WF04-18), cross-client visibility and demo exceptions through Core and record actual device/runner results and artifact URLs. Maintain a read-only staging run for boundary checks, then enable bounded writes only with authorized disposable fixtures. Keep production, the default bridge and local persistent PoC out of GitHub PR configuration. The current hardcoded PoC identities and localhost URL are not staging defaults.

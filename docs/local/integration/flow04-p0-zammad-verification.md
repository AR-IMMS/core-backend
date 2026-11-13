# Flow 04 — P0 Zammad verification report

Verification session: 2026-11-12, Asia/Bangkok. Status: **real-instance probes executed; integration decisions remain pending review; P1 not authorized**.

Only P0 documentation and disposable Zammad probes were performed. No Ticket implementation, IAM changes, Git commits, submodule updates, or production integration were performed. This report is a repository-specific integration finding, not a replacement for shared business rules.

## Sources and evidence boundaries

- [Flow 04 accepted baseline, pinned revision](https://github.com/AR-IMMS/shared-docs/blob/294001cd9f1359bc03ced3925328454cabb3c0ea/business/04-ticket-management.md): BR-01/04/05/06/08/09/10 and §10 govern these decisions. Integration details explicitly remain unverified in that baseline.
- [Shared AI policy](https://github.com/AR-IMMS/shared-docs/blob/294001cd9f1359bc03ced3925328454cabb3c0ea/engineering/AI_CODING_POLICY.md), [AGENTS.md](../../../AGENTS.md), [module architecture](../../../MODULE_ARCHITECTURE_GUIDELINES.md), [IAM specification](../specs/spec-002--epic-iam-module.md).
- Core inspected at `175799d63a49603a9d94a181c8d761d278c0926f`, branch `dev`. Uninitialized shared-docs pointer remains `5e50f66edbb207eb16a41be31d22557404405397`. Reviewed shared baseline is pinned above; no synchronization was performed.
- [BM04 provenance, 22 planned cases and commands](../testing/flow04-test-matrix.md). Numerical commitments are retained. Formal BM04 approval/version verification remains pending.
- Official [Ticket API](https://docs.zammad.org/en/latest/api/ticket/index.html), [Articles API](https://docs.zammad.org/en/latest/api/ticket/articles.html), [states](https://docs.zammad.org/en/latest/api/ticket/states.html), [native Owner meaning](https://user-docs.zammad.org/en/7.0/basics/ticket-basics.html#owner), [search/pagination](https://docs.zammad.org/en/latest/api/intro.html#pagination), [custom objects](https://admin-docs.zammad.org/en/latest/system/objects.html). Documentation describes capabilities; the observations below establish behavior only for the tested instance/configuration.

Evidence labels: **executed** means an actual probe in this session; **reported** means user-supplied manual evidence; **proposed** means a design needing review; **pending** means not demonstrated. Probes are not completed Core acceptance tests or completed CI automation.

## Selected environment and identity observations

| Item | Executed evidence |
| --- | --- |
| Target | `http://localhost:8081`, loopback-bound nginx port; dedicated `zammad-docker-compose-*` stack |
| Application version | Container `/opt/zammad/VERSION`: `7.2.2-45de44f1.docker` |
| Image | `ghcr.io/zammad/zammad:7.2.2-0048` |
| Group | `GET /api/v1/groups/2`: ID **2**, name **AR-IMMS-P0**, active |
| Integration | Zammad ID **6**, `integration@arimms.test`, Agent, full access to group 2 |
| Operator | Zammad ID **4**, `operator@arimms.test`, Agent, full access to group 2 |
| Technician | Zammad ID **5**, `technician@arimms.test`, Agent, full access to group 2 |
| Customer | Zammad ID **7**, `customer@arimms.test`, Customer, no agent group grants |
| Credential | Existing PAT loaded from Git-ignored `.env.local`; token never printed, committed, or included in this report |

Account/group details were first inspected read-only through Rails, then confirmed through authenticated REST. A separate `compose-*` stack on port 8080 was discovered and left untouched. An unauthenticated version-endpoint probe returned 403; the running container file supplied the version. Initial Docker access required sandbox escalation; read-only access subsequently succeeded. An initial Rails command failed from Windows quoting, then succeeded using stdin; neither failure is a successful contract probe.

**Core IAM-to-Zammad mapping is not verified.** No approved Core user IDs or mapping records were supplied. Matching email labels or matching role names do not establish identity equality. Existing Core [HumanAccessPort](../../../src/modules/iam/application/ports/human-access.port.ts) can validate a Core principal and permissions; its [public entrypoint](../../../src/modules/iam/index.ts) must be used, not private IAM persistence.

Proposed identity contract: explicit, reviewed `(Zammad instance, Core immutable user ID) → Zammad user ID` mappings; unique reverse mapping for accountable human identities; active Core principal and active eligible Zammad account/group membership required. Missing, ambiguous, inactive or wrong-group identities fail closed. Email can help an administrator establish a mapping, but is not a runtime identity key or an authorization rule. Do not auto-create users via `guess:` or grant Core permissions from Zammad Agent status. Mapping storage/provisioning owner remains pending. Trace: TC-WF04-20.

## Executed minimum REST contract

All mutated Tickets were newly created in group 2. Existing Ticket 3 was read only. Bodies contained disposable probe text; no external email Articles were sent.

| Probe | Observation | Limit / test trace |
| --- | --- | --- |
| Read existing Ticket | ID 3 / number 11003, group 2, native owner 5, customer 7, state 2 | Confirms user's prior retrieval; not Core authorization (01,04) |
| Read existing Articles | Article 3: phone, public, creator 4, origin 7, Customer; Article 4: note, internal, creator 5, origin null, Agent | Confirms reported UI Article metadata, not delegated creation policy (05) |
| Create | POST `/api/v1/tickets` → 201, new Ticket **4**, explicit group 2/customer 7/owner 4/state 1, initial internal note | Same ID readable; required/default omission behavior not exhausted (01) |
| Reassign | PUT Ticket 4 with `owner_id:5` → 200, owner 5 | Native owner represents the assigned agent; no separate approved Business Owner field exists (04) |
| Lifecycle | Ticket 4: 1→2→3→2→4→2; all five PUTs returned 200 with requested state | Mapping below; does not establish authorization or external-writer race safety (13–17) |
| Stale conditional update | PUT Ticket 4 title with `If-Match: "known-stale-p0-value"` returned 200 and changed title; no ETag observed in that response | This tested endpoint did not enforce that precondition; do not generalize to every possible concurrency mechanism (21) |
| Same-key create | Two separately confirmed POSTs with identical payload and identical `Idempotency-Key` created **Tickets 6 and 7**, both 201 | Native header did not deduplicate. These were intentional confirmed requests, not retries of an uncertain outcome (11) |
| Recovery lookup | Created **Ticket 5**, discarded its response from recovery logic; queried `group_id:2 AND tags:arimms-p0-recovery-05aeee8d58384599b32cda65bd6f7a8b` twice; both returned only ID 5 | Controlled application response discard, not a TCP/proxy fault or Core crash; no second POST issued (11) |
| Actual connection loss | Local loopback fault proxy sent one POST upstream, observed 201 / **Ticket 8**, then closed the downstream socket without an HTTP response. Client raised `RemoteDisconnected`. First group/tag search returned **zero**; later search returned only ID 8, whose group and exact stored tag were verified. | Demonstrates delayed discoverability after confirmed acceptance; no resend. Not a Core crash/receipt test (11) |

The lifecycle probe used explicit state IDs. Observed definitions: **NEW=1 (`new`), OPEN=2 (`open`), PENDING candidate=3 (`pending reminder`), CLOSED=4 (`closed`)**. PENDING probe supplied a future `pending_time`. State 6 is `pending close`, with next state 4: it is not the proposed business PENDING mapping. Approval must cover pending-time semantics and scheduler behavior. Long-running scheduler effects, unsupported transitions, direct closure from NEW/PENDING and reopen automation were not tested. Core must enforce the business transition set; API acceptance alone is not a business rule.

Probe Ticket 4 marker: `arimms-p0-decfe351b586427cbd8e444f8b0ad59e`. IDs 4–8 are disposable evidence retained in group 2; no deletion/cleanup performed. Articles 5–12 on Tickets 4–7 were confirmed by final readback. Ticket 4 ended OPEN with native owner 5. Tickets 5–8 were created NEW with native owner 4. Ticket 8 marker: `arimms-p0-wireloss-b03f8b8673cf4460aeebefe5a0868de9`. The transient fault proxy was shut down after the probe.

## Owner, Assignee and initial Business Context decision

The native owner is a responsible agent, not automatically the AR-IMMS accountable Business Owner. Real Ticket 3 and reassignment of Ticket 4 demonstrate `owner_id=5` for the Technician. Inspection of current Ticket columns matching owner/assignment/AR-IMMS/external/lock names found only `owner_id` and `last_owner_update_at`; it did not establish a second responsibility field. Neither `customer_id` nor Article origin is an accountable Business Owner field.

**Decision pending:** Flow 04 §10 currently assigns owner/assignee truth to Zammad. A Core-authoritative Business Owner would change that allocation and requires business/technical-owner approval. It must not be silently introduced as a “cache.” The tested instance currently cannot demonstrate distinct Operator accountability and Technician assignment through the inspected native fields alone.

| Option | Consequence | Status |
| --- | --- | --- |
| Zammad holds both responsibilities | Candidate: native owner for Assignee and approved separate attribute for Business Owner, or inverse mapping if chosen by owners. Verify field type, identity references, creation/read/update/search, visibility and history. | Preserves current source-of-truth baseline; no custom field name/type/mapping approved or installed |
| Core holds AR-IMMS Business Owner; Zammad holds native Assignee | Explicitly classify Business Owner as AR-IMMS context, amend §10 interpretation with owner approval; never mirror canonical Ticket state/articles/Assignee. | Proposed alternative only; requires approved boundary change |

**P1 adjustment:** minimum initial context/recovery persistence belongs in P1-C/P1-D, not P5. Persist stable instance/reference, initiating Core actor and recoverable context intent before dispatch; link the canonical Zammad ID after confirmation. If the Core-owner option is approved, persist validated `business_owner_core_user_id` in that initial intent and completed context in P1. Do not report a completed creation when its mandatory Owner context is missing. If Zammad owns both roles, resolve/read them there; do not add a competing authoritative Owner column in Core.

No local title/status/priority/Assignee/conversation mirror. Proposed minimal context is `(instance_id, zammad_ticket_id, created_by_core_user_id)` plus only approved Core-owned attributes and timestamps. Creation receipts are integration state, not Tickets. Business-link extensions remain P5. Default Business Owner is unresolved: explicit validated owner selection is proposed for initial creation rather than silently choosing creator, service account, customer or native owner. Owner-change permissions and representation of imported Zammad Tickets also need a decision. Unknown/missing ownership must not authorize closure.

## Article attribution findings

POST `/api/v1/ticket_articles` probes on Ticket 4 and subsequent GET readback:

| Article | Submitted attribution | Returned/read attribution |
| --- | --- | --- |
| 5 (initial Article) | sender Agent, origin 4 | creator 6 / `integration@arimms.test`; origin 4; sender **Customer**; internal true |
| 6 | sender Agent, no origin | creator 6; origin null; sender Agent; internal true |
| 7 | sender Agent, origin 5 | creator 6; origin 5; sender **Customer**; internal true |
| 8 | sender Customer, origin 7 | creator 6; origin 7; sender Customer; internal true |
| 9 | sender Agent, `created_by_id:5` | creator **6**; origin null; sender Agent; internal true |

Supplying `created_by_id` did not impersonate the Technician. `origin_by_id` retained the named user but changed the effective sender even when Agent was requested. Therefore delegated-origin behavior cannot be approved on documentation alone. Original creator labels and numeric IDs were returned consistently on readback. Internal/public flags were observed; actual customer-session visibility, Agent UI rendering and notification effects of these API-created Articles remain untested. No customer or Technician credential was requested or fabricated.

Proposed attribution choices for owner review: accept the demonstrated origin/sender semantics after UI/visibility verification, or keep service-account creator/Agent sender with a clearly labeled AR-IMMS actor reference and durable Core audit association `(Core actor, instance, Ticket ID, Article ID)`. The latter must not falsely label a human as Zammad `created_by`, and requires approval of user-visible attribution. Core stores attribution/audit metadata, not an Article-body replica. Client-supplied author IDs must not determine attribution. Apply the decision to the initial Article in P1 as well as later Articles in P3. TC-WF04-05/22 remain planned Core tests.

## Recovery and concurrency decision

Verified: a unique native tag supplied during one create was discoverable through group-scoped search in two immediate observations. A second probe with actual downstream connection loss found zero initial matches, then found Ticket 8 later; its stored tag was confirmed through `GET /api/v1/tags?object=Ticket&o_id=8`. This demonstrates delayed discoverability, without establishing its precise cause or bound. Not verified: tag uniqueness enforcement, immutability, atomic durability under failures, search availability/lag bounds, exhaustive negative lookup, or behavior under crashes, permissions changes, concurrent requests and triggers. Search success in these probes is not an exactly-once guarantee or an approved reconciliation contract.

Proposed minimum create safeguard:

1. Stable `client_request_id` in the create body; durable receipt unique by instance/actor/request ID with normalized request fingerprint, intended context and dispatch state. A repeated key with different input conflicts. One atomic claimant dispatches; losers read the receipt. Never expire/reissue an uncertain submission automatically.
2. Save dispatch intent before the external request. If persistence fails, do not POST. Make the external POST outside Mongo transactions: [MongoUnitOfWork](../../../src/platform/events/infrastructure/mongodb/mongo-unit-of-work.ts) uses a transaction callback that may be retried.
3. Send one POST containing the approved correlation marker. No transport-level retry of create/append. Save canonical ID and finish context/audit locally after confirmation. Retry local finalization using that same ID; never recreate to repair local persistence.
4. A lost response, crash after dispatch intent, or ambiguous 5xx leaves the receipt unconfirmed. Same-key resubmission performs reconciliation, not POST. A unique exact marker match must be fetched and validated against instance/group/intended context before linking. Zero matches is not proof that no Ticket exists; multiple matches must not be arbitrarily chosen.
5. Only a proved pre-dispatch failure or a documented definitive non-creation result may permit another attempt after policy review. A timeout or canceled client request does not prove the server rolled back. A new client request ID is not a safe workaround.

**Controlled manual reconciliation is a proposed PoC fallback requiring approval.** If reliable automated lookup cannot be established, keep the submission locked/unconfirmed and present a truthful support reference. An authorized integration operator examines scoped Zammad Ticket/history and available request evidence, records the exact canonical ID and evidence, and completes local context once. Titles, timestamps or a single empty search alone are insufficient. If absence or identity cannot be established, leave unresolved; do not resend, synthesize success or delete ambiguous candidates. Define responsible person, response time, evidence retention and auditable resolution procedure before accepting this fallback. No broad operation-management endpoint is required initially.

Both application-level response discard and a real local fault proxy/connection-loss probe were executed. Core crash windows, concurrent receipt claims, local-write failure and Article-response-loss recovery remain required. Article append has its own duplicate risk; Ticket tags do not automatically deduplicate Articles.

Do not mandate `Idempotency-Key`, `If-Match`, ETags or a generic Operation Journal on every endpoint. This instance accepted duplicate same-key creates and stale If-Match updates. A Core-side ETag only describes Core's view and cannot prevent a direct Zammad write. Owner-only closure needs either demonstrated upstream conditional semantics or an approved, enforced PoC writer model covering UI users, integrations, triggers and schedulers. Current human Zammad accounts have full group access, so a Core-only-writer assumption is **not currently established**. Fresh reads alone leave a race. TC-WF04-21 remains a blocker for closure acceptance.

## Core authorization decisions pending

The existing [IAM permissions](../../../src/modules/iam/domain/permission-catalog.ts) and [role baselines](../../../src/modules/iam/domain/role-permissions.ts) include Ticket read/create/manage/close; Technician has read only. No `ticket:work` exists. No IAM changes were made.

Proposed read rule for approval: require active Core identity plus `ticket:read`, approved instance/group membership and resource eligibility. Technicians may read only Tickets they currently own or are assigned; authorized managers may read group-scoped Tickets under an explicit management policy. Apply the same rule to detail, lists, Articles, context and creation responses. Resolve mapped identities from authoritative data; unknown mapping/ownership fails closed. Backend service-account access must not become client access. List pagination, counts and filtering must not disclose unauthorized Tickets; do not filter a single upstream page and then present its count as an authorized total.

This restricted policy remains **proposed**, as does `ticket:work`. Public detail/list retrieval is blocked until IAM/business owners approve the resource policy. Proposed work permission must remain narrower than general management and limited to assigned work; do not grant Technician `ticket:manage` as a shortcut. Current Owner closure and authorized reopen retain BR-05/06, with no implicit Admin override. Core HTTP tests must validate these policies before routes are exposed.

## Roadmap adjustment and review gates

| Phase / small PR | Scope and endpoints (proposed `/api/v1` prefix) | Acceptance and dependency |
| --- | --- | --- |
| P0 | This report, decision review, remaining real probes | Version/group demonstrated; sign off mapping, identity, initial ownership, visibility, attribution, recovery and writer model before dependent work |
| P1-A | Read-only Zammad adapter and narrow application read port; **no public endpoint** | Strict response mapping, scoped ID read, sanitized failures/timeouts; fake contract and real fixture readback; no Ticket store or IAM change |
| P1-B | `GET /tickets/{id}` | Approved resource visibility and identity mapping; H/F/R coverage, no data leakage |
| P1-C | Minimum creation receipt and initial business-context persistence | Concurrent same-request claim, local transaction/outbox failure recovery; approved owner storage decision; no network call in transaction |
| P1-D | `POST /tickets` manual creation/retrieval vertical slice | Approved default Owner, initial Article attribution, recovery, honest uncertain response; TC-01/03/11/12/20 relevant executions |
| P2 | `GET /tickets`, `PUT /tickets/{id}/assignment` | Approved distinct responsibilities, complete authorized pagination; TC-04/06 |
| P3-A/B | `PATCH /tickets/{id}`, `POST /tickets/{id}/status`, `GET/POST /tickets/{id}/articles` | Approved work policy, attribution and append recovery; field allowlists prevent closure/assignment bypass; TC-05/13–15/19/22 |
| P4-A/B | `POST /tickets/{id}/close`, `POST /tickets/{id}/reopen` | Owner/permission rules, writer-race solution, history and independent lifecycles; TC-07–09/16/17/21 |
| P5-A | `GET/PUT /tickets/{id}/context`, Asset links | Approved Asset public query export; no private module access; TC-10 |
| P5-B/C | Reviewed Incident draft and Maintenance integration | Blocked until owning modules expose approved public contracts; no fake implementation or success response |
| Staging | Actual Web/Core/Zammad/Mobile flow | TC-18, DS-04a/b, full 22-case/BM04 evidence; partial backend delivery is not complete BM04 fulfillment |

The read adapter belongs in Ticket infrastructure, its narrow port in application; policies in Ticket domain/application. Follow [module guidelines](../../../MODULE_ARCHITECTURE_GUIDELINES.md), existing [HTTP baseline](../../../api/baseline.yaml) and [Core composition](../../../src/app/core.module.ts). Update concrete OpenAPI with each future endpoint PR. Asset query provider currently exists but is not exported from [AssetTopologyModule](../../../src/modules/asset-topology/asset-topology.module.ts); Incident/Maintenance implementations are absent.

Effort remains conditional: remaining P0 validation/review preparation approximately 2–5 engineer-days once Core identity fixtures and decisions are available; additional waiting time is separate. P1-A 1–2 days, P1-B 0.5–1, P1-C 1–2, P1-D 3–5 (P1 approximately 6–10). P2 2–4, P3 3–6, P4 2–4, P5-A 1–3; Incident/Maintenance and client automation unestimated until contracts/environments exist. A custom attribute or writer-enforcement solution may increase these estimates. Manual recovery approval can simplify automation scope but adds an operational acceptance obligation.

**Recommendation:** review these findings before starting P1-A. It is the safest first coding task once explicitly authorized: a read-only, scoped adapter tested with observed fixtures. Do not treat that approval as permission to expose retrieval, mutate IAM or implement creation. P0 has demonstrated useful API behavior but has not resolved every business/integration decision.

## PowerShell reproduction: read-only checks

Run from `core-backend`. Version command executes against the selected running container:

```powershell
docker exec zammad-docker-compose-zammad-railsserver-1 cat /opt/zammad/VERSION
```

The following loads only the two Zammad settings from the ignored file. Do not echo headers or enable request tracing. It performs read-only probes; successful execution is not a Core authorization test.

```powershell
Set-Location 'C:\Users\Admin\AR-IMMS backend\core-backend'
foreach ($line in Get-Content -LiteralPath '.env.local') {
  if ($line -match '^\s*(ZAMMAD_BASE_URL|ZAMMAD_API_TOKEN)\s*=(.*)$') {
    $settingName = $Matches[1]
    $settingValue = $Matches[2].Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($settingName, $settingValue, 'Process')
  }
}
$p0Base = $env:ZAMMAD_BASE_URL.TrimEnd('/')
if ($p0Base -ne 'http://localhost:8081' -or -not $env:ZAMMAD_API_TOKEN) {
  throw 'P0 target or credential is unavailable'
}
$p0Headers = @{ Authorization = "Token token=$env:ZAMMAD_API_TOKEN" }
$p0Group = Invoke-RestMethod "$p0Base/api/v1/groups/2" -Headers $p0Headers
if ($p0Group.name -ne 'AR-IMMS-P0') { throw 'P0 group mismatch' }
$p0Group | Select-Object id, name, active
$p0Ticket = Invoke-RestMethod "$p0Base/api/v1/tickets/4" -Headers $p0Headers
if ($p0Ticket.group_id -ne 2) { throw 'P0 Ticket scope mismatch' }
$p0Ticket | Select-Object id, group_id, owner_id, customer_id, state_id
Invoke-RestMethod "$p0Base/api/v1/ticket_states" -Headers $p0Headers |
  Select-Object id, name, state_type_id, next_state_id
Invoke-RestMethod "$p0Base/api/v1/ticket_articles/by_ticket/4" -Headers $p0Headers |
  ForEach-Object { $_ | Select-Object id, created_by_id, created_by, origin_by_id, sender, internal }
```

Mutation probes used JSON requests with the exact fields/results described above, a fresh unique marker, explicit group 2, and a scope GET before each mutation. Do not replay ambiguous create/append requests. Repeat deliberate duplicate-header tests only as separately confirmed disposable requests. Subsequent automated runners and real network fault injection need their own reviewable P0 fixtures; none are production Ticket code.

## Remaining blockers and evidence status

1. Approve distinct Business Owner/Assignee source and field mapping; determine initial/default Owner and Core context allocation.
2. Supply approved Core identity fixtures and mapping ownership; validate through public IAM contract.
3. Approve resource visibility before P1-B/list, and work permission before Technician updates.
4. Resolve delegated Article sender behavior and verify actual role-based UI visibility; choose attribution for initial creation.
5. Approve and validate correlation mechanism or controlled manual fallback; extend the executed response-loss probe to Core crash/concurrency/local-write and Article recovery. No exactly-once claim.
6. Approve and demonstrate protection against stale ownership for closure; current If-Match probe failed to protect a mutation.
7. Keep formal BM04 approval pending. Real Web/Mobile E2E, CI automation and all 22 Core acceptance cases remain unexecuted.

The REST probes above executed successfully where stated; the idempotency and stale-precondition probes established unsupported guarantees rather than passing those proposed guarantees. No unit/HTTP/fake-Zammad/Core E2E suite was run for this documentation-only change. See the linked matrix for exact existing repository commands and future acceptance requirements.

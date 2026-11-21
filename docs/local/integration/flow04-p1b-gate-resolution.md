# Flow 04 P1-B.1b - integration gate resolution

Date: 2026-11-20. Sections 9–10 document the private deployment, writer-isolation and internal P1-B.2 gates. The subsequent Master Task enabled the public Ticket API and workflows. See the [backend completion report](flow04-backend-completion.md) for current implementation, acceptance and remaining dependencies.

**Latest business-scope decision:** OPERATOR alone receives management-scope Ticket access, subject to IAM permissions. TECHNICIAN receives current Business Owner-or-Assignee visibility. IT_ADMIN receives no Ticket business access, regardless of inherited permissions, Owner claims or mapping presence. Mapping administration is not a Ticket-access grant. Only Operator `403678c5-a90b-4a06-9a7d-318f27a3c639` -> Zammad 4 and Technician `53cd2a15-5221-4f49-a822-3c56e4cca637` -> Zammad 5 are approved human pairs. No admin1 mapping may be created; service 6 remains a technical identity. Both approved records were subsequently provisioned and their Audit evidence reverified; see sections 8–9. See [negative authorization cases and shared-baseline amendments awaiting approval](flow04-ticket-role-scope-correction.md).

## 1. Runtime access gate: direct-group contract implemented and read-verified

Running VERSION again returned `7.2.2-45de44f1.docker`. GitHub resolves that revision to [45de44f10154b3c0cccfbbf694a29c4f5cf2ea5d](https://github.com/zammad/zammad/commit/45de44f10154b3c0cccfbbf694a29c4f5cf2ea5d). Relevant deployed files were read and compared with the corresponding pinned source excerpts; this is not a whole-image integrity attestation.

Fresh credential-authenticated GET observations on `http://localhost:8081`:

| Request                             | Observed result                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/users/me?expand=true`      | 200; id 6, active true, role_ids [2], group_ids {"2":["full"]}                                                                           |
| `/api/v1/users/4?expand=true`       | 200; id 4, active true, role_ids [2], direct group 2 full                                                                                |
| `/api/v1/users/5?expand=true`       | 200; id 5, active true, role_ids [2], direct group 2 full                                                                                |
| `/api/v1/users/7?expand=true`       | 200; id 7, active true, role_ids [3], empty group map                                                                                    |
| `/api/v1/users/1?expand=true`       | 200; id 1, active false, no roles, empty group map                                                                                       |
| `/api/v1/roles/2?expand=true`       | 200; active true; permissions are chat.agent, cti.agent, knowledge_base.reader, **ticket.agent**, user_preferences; empty role group map |
| `/api/v1/object_manager_attributes` | 403 with existing Integration credential; do not elevate it for field installation                                                       |

IDs above are observations, not constants for business logic. The previous `/permissions` 404 is no longer a blocker: expanded roles expose names. [Official expansion documentation](https://docs.zammad.org/en/latest/api/intro.html#response-payloads-expand) describes named relations. However, [pinned RolePolicy](https://github.com/zammad/zammad/blob/45de44f10154b3c0cccfbbf694a29c4f5cf2ea5d/app/policies/role_policy.rb) limits non-admin role reads to roles assigned to the caller. Do not make arbitrary role enumeration a runtime requirement.

**Recommended minimum contract:** `GET users/me` plus `GET users/{explicitlyBoundId}` on the configured origin; require exact numeric IDs, `active === true` and a well-formed `group_ids` map containing the configured group with `full`. Require full for the initial two provisioned Agent accounts because native assignment is part of their intended use; expanding to read-only agents needs a later policy choice. Do not use `roles` display strings, numeric role/permission constants or email.

This also verifies Agent eligibility for this pinned deployment: [CanAssociations](https://github.com/zammad/zammad/blob/45de44f10154b3c0cccfbbf694a29c4f5cf2ea5d/app/models/application_model/can_associations.rb#L170) serializes `group_ids_access_map`; [HasGroups](https://github.com/zammad/zammad/blob/45de44f10154b3c0cccfbbf694a29c4f5cf2ea5d/app/models/concerns/has_groups.rb#L253) checks `permissions?('ticket.agent')`, user activity, and active direct groups. Role-derived groups are combined by a different access-query method, not this map. Thus a positive required direct-group entry is server-filtered Agent eligibility, not an inference from role names. Expanded role permissions are corroboration for the selected accounts, not the authoritative fallback when this map is empty.

Runtime rules implemented by the internal adapter:

1. Compare `/users/me.id` with the approved service ID in deployment configuration. Reject mismatch/inactive service; no automatic adoption of a replacement credential identity.
2. Resolve a reviewed Core mapping; fetch that exact external user. Require strict ID match, active flag and direct full access. Missing fields, unknown access representation, 401/403/404, timeout or malformed response fail closed; never use a cached last-good result after failure.
3. Reject the configured service ID and a reviewed deployment denylist of system/non-human accounts. P0 denylist includes system 1, integration 6 and customer 7. Do not hardcode those IDs into domain code. Customer-only accounts also fail the direct Agent group test.
4. Human nature is a provisioning assertion, not a universal API flag. Only positively approved human pairs may enter the mapping collection; another service account must not become human merely because it has Agent access.
5. Refetch per request initially. Zammad serialization caches exist, so do not claim instantaneous revocation; test invalidation on deactivation/group/role revocation before release. Version upgrades require rerunning these contract probes.

**Limitations:** inactive-human, permission-revocation and role-only-group negative mutation probes have not run. Existing inactive system and customer negative observations passed. If a version changes serialization or stops exposing the map, deny access and stop rollout. Secure fallback for approval would be reviewed static eligibility plus live id/active checks with documented delayed revocation; this weakens live external-access validation and is NOT recommended while the direct-group contract works. No Rails/DB call is needed at runtime, and no service privilege elevation is needed for the chosen PoC.

## 2. Exact proposed Business Owner field - not installed

Recommend `arimms_business_owner_id`, display `AR-IMMS Business Owner`, on Ticket, integer scalar holding the canonical Zammad human user ID. Native `owner_id` remains Assignee. The [pinned attribute validator](https://github.com/zammad/zammad/blob/45de44f10154b3c0cccfbbf694a29c4f5cf2ea5d/app/models/object_manager/attribute/data_option_validator.rb) supports integer min/max within signed 32-bit range. Integer is simpler than introducing an unverified custom user-selector relation.

Proposed POST `/api/v1/object_manager_attributes` payload, using a separately authorized administrator, never the integration token:

```json
{
  "object": "Ticket",
  "name": "arimms_business_owner_id",
  "display": "AR-IMMS Business Owner",
  "data_type": "integer",
  "data_option": { "default": null, "min": 1, "max": 2147483647, "null": true },
  "active": true,
  "editable": true,
  "position": 1550,
  "screens": {
    "create_middle": { "ticket.agent": { "shown": true, "required": false } },
    "edit": { "ticket.agent": { "shown": true, "required": false } }
  }
}
```

Nullable at the Zammad schema boundary avoids fabricating ownership for existing Tickets. Core policy must require a valid explicit Owner for newly created AR-IMMS Tickets and deny Technician reads when authoritative Owner data is missing/invalid until an explicit imported-Ticket policy is approved. Permitted Operators may inspect such Tickets within scope for repair; IT_ADMIN has no business-access bypass. No auto-backfill/default Owner, customer visibility or email reference. `editable` and screen options are metadata/UI settings, **not an API writer ACL**.

Core must validate the scalar's range, exact existing active approved human mapping, direct group eligibility and service/system exclusions. An integer field supplies neither referential integrity nor these business checks. Direct raw API writes of an in-range customer/service ID may succeed: that is a policy-bypass finding, not evidence that the field validates identity. Deployment writer restrictions are therefore mandatory for this candidate.

[Official object API](https://docs.zammad.org/en/latest/api/object.html) requires admin.object to create attributes and execute `/api/v1/object_manager_attributes_execute_migrations`, followed by restart. Proposed approval covers exactly this one field, its migration and the selected stack's required controlled restart. Before execution, an administrator must inventory pending migrations and stop if unrelated changes would be applied. No other stack restart or existing Ticket backfill is included.

Ticket includes HasHistory and does not explicitly exclude this new field in its ignored list ([pinned Ticket source](https://github.com/zammad/zammad/blob/45de44f10154b3c0cccfbbf694a29c4f5cf2ea5d/app/models/ticket.rb)); field-specific history is still a test requirement, not a passed result. Query `/api/v1/ticket_history/{id}` after each approved change and check old/new scalar, actor and timestamp. Integration writes are attributed to service ID; original Core actor requires separate Core Audit correlation.

## 3. Proposed mutation fixtures and executable matrix

**Approval request scope, no execution yet:** install the one field above; create one disposable Ticket in configured AR-IMMS-P0 group with customer 7, Assignee 5, Business Owner 4 and one internal note; change only that new Ticket during probes. Preserve Ticket 3. Create two additional synthetic Agent fixtures only if approved: `p0-inactive-owner-probe@arimms.test` (active false, existing verified Agent role, direct group 2 full) and `p0-wronggroup-owner-probe@arimms.test` (active true, same role, no AR-IMMS group access). Resolve role/group IDs from reviewed instance data, capture returned user IDs, never invent them. No existing user's roles/groups/status change is proposed. Fixture cleanup or retention needs an explicit choice; no automatic deletion.

Use securely supplied service/admin/Technician credentials for the appropriate actor. Technician probes require a real Technician session/token, not service-account impersonation. Log only sanitized results. Record approved origin, group, newly returned Ticket/user IDs, before/after JSON allowlist and history for every probe.

| Probe                        | Executable request sequence after approval                                                                                                              | Required assertion / current status                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 distinct responsibilities | POST tickets with `owner_id:5`, `arimms_business_owner_id:4`, then GET returned ID                                                                      | Both fields retained independently; NOT RUN                                                                                                                                                                                               |
| V2 reassignment              | PUT new Ticket `{ "owner_id":4 }`, GET, then restore owner_id 5                                                                                         | Business Owner stays 4; NOT RUN                                                                                                                                                                                                           |
| V3 Owner/history             | Authorized service PUT `{ "arimms_business_owner_id":5 }`, GET and GET ticket_history; restore 4 and check history                                      | Owner change recorded, native owner unaffected; NOT RUN                                                                                                                                                                                   |
| V4 Technician self-Owner     | From normal Technician client/network, attempt PUT `{ "arimms_business_owner_id":5 }`                                                                   | Enforced ingress blocks request before Zammad; service readback unchanged; NOT RUN                                                                                                                                                        |
| V5 Technician self-Assignee  | First service sets native owner 4, then Technician attempts PUT `{ "owner_id":5 }`; service GET, finally authorized restore                             | Blocked and unchanged; NOT RUN. Current full group policy alone does not supply this protection                                                                                                                                           |
| V6 identity validity         | Candidate values null, 0, fractional, unknown unused ID verified absent, system 1, service 6, customer 7, and returned inactive/wrong-group fixture IDs | Core approved eligibility rules deny all, with zero mutation calls; future policy harness NOT IMPLEMENTED. Optional approved raw-Zammad probes characterize which values Zammad accepts; never equate raw acceptance with policy approval |

Minimal PowerShell request procedure (for later manual execution, **not executed now**):

```powershell
# Existing secure process variables. Never print headers or token values.
$base = 'http://localhost:8081'
$headers = @{ Authorization = "Token token=$env:ZAMMAD_API_TOKEN" }
# After explicit mutation approval and fixture ID capture:
# $fixtureId must be the newly returned Ticket ID, never Ticket 3.
# Verify its group against the approved deployment setting before each mutation.
$before = Invoke-RestMethod "$base/api/v1/tickets/$fixtureId" -Headers $headers
if ($before.group_id -ne [int]$env:ZAMMAD_EXPECTED_GROUP_ID) { throw 'Wrong fixture scope' }
# V2 example: execute only within separately approved mutation session.
Invoke-RestMethod "$base/api/v1/tickets/$fixtureId" -Method Put -Headers $headers -ContentType 'application/json' -Body '{"owner_id":4}' | Out-Null
$after = Invoke-RestMethod "$base/api/v1/tickets/$fixtureId" -Headers $headers
if ($after.owner_id -ne 4 -or $after.arimms_business_owner_id -ne 4) { throw 'V2 failed' }
```

V1 POST body: title `AR-IMMS P1-B.1b approved disposable probe`, configured group_id, owner_id 5, customer_id 7, arimms_business_owner_id 4, article `{ "subject":"Owner probe", "body":"Disposable integration verification", "type":"note", "internal":true }`. Use returned ID, then V2/V3 PUT bodies in the table. V4/V5 run with Technician credentials from the actual restricted network path; connection refusal/403 is acceptable only with independent canonical unchanged readback. If host-local bypass is possible for an untrusted Technician, the writer gate fails. V6 cannot be marked passed until its future policy harness exists; these probes are not additional BM04 business IDs.

## 4. PoC writer model - recommend deployment enforcement

Keep Agent identities active with direct full group membership for assignment, but make Zammad reachable only by the Core service and approved administrator/support ingress. Normal Web/Mobile clients have Core credentials only. Do not distribute human Zammad passwords/PATs; revoke existing human sessions/tokens and restrict login/SSO paths through an approved maintenance procedure. Network separation must also block direct API, GraphQL, WebSocket and alternate host/port routes, not just hide the Web UI. Do not deactivate mapped humans as a shortcut: that conflicts with active identity validation.

Current selected Docker port is loopback 8081. That limits remote access but does **not** prevent local users or other privileged containers from calling Zammad. No complete writer restriction is claimed or installed. For the PoC, recommend treating the host and deployment administrators as trusted, excluding Technician shell/container access, exposing only Core to clients, and permitting Zammad support access through a restricted bastion/VPN path with recorded maintenance approval. Exact network identities and ingress rules must be reviewed by the deployment owner before applying changes.

Consequences:

- Core first excludes IT_ADMIN from every Ticket business operation, then enforces Operator scope and Technician Owner-or-Assignee reads; Zammad group privileges remain broader and must not be directly reachable by ordinary humans.
- Native assignment and custom Owner changes go through authorized Core operations. The existing [TicketPolicy](https://github.com/zammad/zammad/blob/45de44f10154b3c0cccfbbf694a29c4f5cf2ea5d/app/policies/ticket_policy.rb) authorizes Agent updates from group change/full access, not AR-IMMS responsibility rules. Both self-grant probes would be unsafe to assume denied under today's account privileges alone.
- Owner-only closure is a future Core rule, not a Zammad guarantee. Until implemented, no claim of enforced Core closure workflow.
- Only one ordinary writer reduces races; it does not eliminate Zammad triggers, schedulers or emergency admins. Inventory automation affecting owner/state/custom field. Do not claim If-Match or Core ETags lock external changes.
- Emergency support: named trusted admin, reason/time window, pause affected Core mutation operations, capture before/history/after, repair/validate identity context, then resume. Direct admin changes are an explicit trusted exception, never silent Owner-only closure compliance. Audit original admin separately from integration service activity.

If this deployment isolation cannot be enforced, do not enable Technician reads based on self-editable responsibilities. Escalate a narrower release or a different ownership/writer design for explicit business/security approval; Core-owned Business Owner alone still does not protect native assignment self-grants.

## 5. Candidate pairs and provisioning runbook

**Approved provisioning completed and verified on 2026-11-19.** The authenticated actor was admin1, immutable Core ID `9c52d3fe-1bf7-4255-8654-6ec9c315070e`, ACTIVE IT_ADMIN with user:manage and no pending password change. Token validity was confirmed through GET auth/me before writes. Complete public directory pagination was checked before each POST: no matching username or email existed. Exactly one POST per account used the approved username, email and role, without display_name or extra permission fields. No ambiguous response or mutation retry occurred.

| Username   | Immutable Core ID                      | Role/status         | Candidate Zammad ID | Creation Audit event                   |
| ---------- | -------------------------------------- | ------------------- | ------------------- | -------------------------------------- |
| operator   | `403678c5-a90b-4a06-9a7d-318f27a3c639` | OPERATOR / ACTIVE   | 4                   | `56beecd7-6e06-4652-8512-114ad3b387ae` |
| technician | `53cd2a15-5221-4f49-a822-3c56e4cca637` | TECHNICIAN / ACTIVE | 5                   | `204247e2-8dd7-46d7-b377-b6f03031d629` |

Both POST `/api/v1/users` calls returned **201** with Cache-Control no-store, server-generated IDs, ACTIVE status, empty additional_permissions and mandatory initial password change. Each account then successfully logged in with its generated temporary credential and completed POST `/api/v1/auth/change-password` using its own session. Subsequent own GET auth/me and administrator GET `/api/v1/users/{id}` agreed on ID, role, ACTIVE status and **must_change_password=false**. Final complete user enumeration returned exactly three users: admin1, operator and technician.

Credentials were never printed or included in this document. Approved ignored local storage is `.tmp/flow04-poc-credentials/operator.json` and `technician.json`, with directory ACL inheritance removed and access granted to the current Windows user and SYSTEM. Each contains its final generated password and session credentials; temporary passwords were removed after successful change. Do not attach/commit these files. Local creation-intent receipts prevent accidental blind reruns of the provisioning helper. Existing short-lived admin credentials were not changed.

**Baseline permission verification PASS:** additional_permissions is empty for both, and effective sets match the repository role catalog:

- Operator: asset:read, monitoring:read, incident:read, incident:investigate, incident:manage, ticket:read, ticket:create, ticket:manage, ticket:close, maintenance:read, maintenance:manage, maintenance:verify (12).
- Technician: asset:read, monitoring:read, ticket:read, maintenance:read, maintenance:execute (5).

No ticket:work, role-definition edits, permission grants or admin-to-integration mapping were introduced. These capabilities are coarse IAM access only; no Ticket resource authorization use case exists yet.

**Creation Audit verification PASS through public API:** GET `/api/v1/audit/events?resource_type=iam.user&resource_id={CoreId}&page_size=100` returned 200 and terminal next_cursor null for each user. Each event in the table has action iam.user.created, actor admin1 (`9c52d3fe-1bf7-4255-8654-6ec9c315070e`) and the matching iam.user resource ID. Operator creation occurred at `2026-11-19T14:08:47.981Z`, recorded at `14:08:48.179Z`; Technician creation occurred at `14:08:48.302Z`, recorded at `14:08:49.191Z` (UTC). This verifies delivered creation records rather than inferring Audit success from 201. Password change success was verified via API/account state; a separate delivered password-change Audit event is not claimed by these creation-event observations.

Creation request IDs: operator `f0ae98f6-b801-4b76-8a15-092292b9feb6`; technician `ba42d159-e200-4b09-ac1e-35ac93142640`.

The exact approved mapping pairs are therefore:

- `403678c5-a90b-4a06-9a7d-318f27a3c639` -> Zammad **4** (Operator).
- `53cd2a15-5221-4f49-a822-3c56e4cca637` -> Zammad **5** (Technician).

These are **verified account IDs and approved bindings, not inserted mappings**. Emails operator@arimms.test and technician@arimms.test are profile values, not runtime identity keys. Admin1 has no proposed Zammad mapping; Zammad service 6, customer 7 and system 1 remain excluded.

Fresh Zammad API reads again confirmed humans 4/5 active with direct full group-2 access; service 6 matched users/me, customer 7 had no group access, system 1 was inactive, and expanded role permissions included ticket.agent. Object-manager API remained 403 for the integration credential. No privilege increase or Zammad mutation was attempted.

Executed helpers (ignored, contain no hardcoded credentials): `node .tmp/flow04-provision-approved.cjs` (one-shot approved mutations; refuses existing receipts), `node .tmp/flow04-provision-audit.cjs` (read-only), `node .tmp/p1b1b-probe.cjs` (read-only Zammad). Do not rerun the creation helper to resolve an unclear result: use exact-ID reads and stored sanitized receipts. The old probe's exploratory port-3000 availability message is irrelevant; verified Core is port 8082.

Sources: [user controller](../../../src/modules/iam/presentation/users.controller.ts), [provisioning service](../../../src/modules/iam/application/user-provisioning.service.ts), [authentication controller](../../../src/modules/iam/presentation/auth.controller.ts), [baseline roles](../../../src/modules/iam/domain/role-permissions.ts). Existing users were preserved; no direct MongoDB writes were used.

Proposed authority: named active Core IT Admin with existing `user:manage` plus explicit integration-owner operational approval; second reviewer confirms each exact human pair and one-group scope. This is an operational policy requiring approval, not a new IAM permission or an assertion that any user:manage holder already has integration authority.

Runbook:

1. Obtain an authenticated Core admin session securely. Enumerate candidates via user:read API; record exact user_id, role and ACTIVE status. Human owner/reviewer confirms the person behind external ID 4 or 5. Email can assist this review but is never evidence of equality by itself.
2. Verify admin identity/capability with IAM public contracts. A supplied `approvedByCoreUserId` string is insufficient proof. Record separate actor and reviewer, approval reference, timestamp, instance generation and origin/group/service identity.
3. Dry-run exact pairs against both unique indexes including revoked records; verify current Core identity and external direct-group contract. Refuse service/system/customer, ambiguous, inactive or wrong-scope candidates. No opportunistic remapping.
4. After provisioning authority and implementation are separately approved, write mapping plus Audit/outbox fact atomically through an internal restricted application command. No unrestricted DB script. Record before/after status/revision and pair IDs, never tokens/passwords. The internal create-only use case now exists, but no authenticated operational entry point or authority provider is enabled; actual insertion remains blocked.
5. The same designated authority may revoke; record reason and expected revision. Reactivation requires renewed two-system eligibility and reviewer approval. Preserve revoked rows and unique constraints. Never reassign a retired external ID to another Core user via delete/recreate.
6. Record successful readback and audit reference. No P1-B.2 authorization acceptance until actual approved pairs exist. Emergency revoke authority and second-review timing must be explicitly agreed; do not bypass auditing.

## 6. Decisions and exact start gates

| Decision                     | Recommended choice                                                                                                    | Required approval/evidence                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime external eligibility | Pinned user id/active/direct-full group contract; users/me service match; positive human provisioning and denylist    | Integration/security owner accepts version-bound contract; mutation revocation probes before release                                                         |
| Owner storage                | Proposed nullable integer field arimms_business_owner_id in Zammad, Core-required valid Owner for managed new Tickets | Business + Zammad administrator approve exact field/migration/restart and fixture mutations                                                                  |
| Writer trust                 | Core ordinary writer, trusted support only, enforced client network isolation                                         | Deployment/security owner supplies ingress rules and trusted-host boundary; V4/V5 must pass                                                                  |
| Core pairs                   | Exact public-IAM IDs for Zammad 4 and 5                                                                               | Both accounts now provisioned and verified; Exact pairs approved; implementation of authenticated/audited mapping insertion remains gated                    |
| Provisioning                 | Named active IT Admin + integration approval + second pair review; transactional audit                                | IAM/security owner approval and separately authorized restricted write tooling                                                                               |
| P1-B.2 start                 | Authorization-use-case-only PR after these decisions                                                                  | Explicit phase approval, approved pairs/provisioning path, Owner contract demonstrated, writer gate evidenced, live access and revocation semantics accepted |

Immediate next approval: approve authenticated/audited mapping provisioning authority and insertion tooling for the two already-approved pairs; separately approve the bounded Zammad field/fixture probes and enforced writer boundary. Core test-account creation is complete and needs no further creation approval. P1-B.2/.3 remain stopped.

### Bounded Zammad probe rollback and stop rules - separate approval required

The proposed mutation scope remains one custom field and its migration/selected-stack restart, one new group-2 disposable Ticket, and the two optional synthetic inactive/wrong-group Agent fixtures described in section 3. Existing Zammad users, roles/groups, Ticket 3 and port-8080 stack stay untouched. Integration credential permissions stay unchanged; field administration requires the separately approved administrator credential.

Before execution capture the new fixture's allowed fields and existing object-definition inventory; verify no unrelated pending migration. For each Ticket mutation, read back and save history evidence, then restore **only the new fixture** to owner_id 5 and arimms_business_owner_id 4. If restoration cannot be confirmed, stop further writes and retain the exact fixture ID for admin repair. Do not retry an uncertain create or mutate a different Ticket to compensate.

If field validation fails, stop adoption. Proposed rollback is administrator disabling this newly created attribute after checking references, retaining the column/data/history for diagnosis; do not drop columns, delete existing Tickets or reset/restore the entire database. Record whether restart is required for the approved reversal. Newly created synthetic users should be deactivated and retained only if this cleanup is approved; no existing user is altered. New Ticket closure/deletion is not part of rollback: retain it visibly as a disposable fixture until separate cleanup approval.

Network writer restrictions are a distinct deployment change and require the owner to provide exact Core/admin ingress identities and approve the before/after rules. Back up that configuration; if it must be reverted, pause Core mutation workflows and do not claim the Core-only writer boundary still holds. V4/V5 must demonstrate denied Technician requests on the real client path with unchanged canonical readback. An administrative bastion exception is trusted and audited, not ordinary Technician access.

## Evidence and preservation

Commands executed: read-only Docker `cat`/source inspection; `node .tmp/p1b1b-probe.cjs`; `node .tmp/p1b1b-core.cjs`; successful `node .tmp/flow04-core-verify.cjs` and Zammad `node .tmp/p1b-access.cjs` continuation; official docs and pinned GitHub source reads. These ignored helpers load the existing local credential without printing it and emit only selected IDs/access fields/status. New GET observations and approved Core IAM mutations are recorded above; no Zammad mutation matrix row is passed. No application tests were rerun for this documentation-only phase. The [22-case inventory](../testing/flow04-test-matrix.md), [P1-B.1 implementation](flow04-p1b1-identity-foundation.md), shared baseline and submodule are unchanged. Formal BM04 approval/version remains pending.

## 7. P1-B.1b implementation and execution evidence ? 2026-11-19

This section supersedes earlier implementation-pending wording. Independent implementation is complete in the working tree; operational provisioning, Business Owner and writer gates remain open. **P1-B.2 is not implemented; P1-B.3 is NO-GO.** No public endpoint or CoreModule registration was added.

### Implemented files and boundaries

| Files | Responsibility |
| --- | --- |
| `src/modules/ticket/application/external-user-access.port.ts` | Narrow `getEligibleHuman(id)` port; eligible ID/group or null; fixed validation errors. |
| `infrastructure/zammad-read.client.ts`, `infrastructure/zammad-ticket-read.adapter.ts` under Ticket | Extract existing fixed-resource GET transport for reuse; preserve Ticket mapping and group checks. No retries, redirects, mutation methods or credential-bearing errors. HTTP failures retain existing `TicketReadError` codes. |
| `infrastructure/zammad-user-access.adapter.ts`, `zammad-user-access.module.ts` under Ticket | Strict id/active/direct-group validation, service identity verification, configured non-human exclusions; opt-in internal Nest provider only. No email, role-ID constants, role-name inference, Rails runtime calls or positive cache. |
| `application/provision-identity-mapping.ts` under Ticket | Internal create-only use case and authority/write ports. Active IT_ADMIN + user:manage is necessary for provisioning, but insufficient without explicit authenticated exact-pair/scope approval. Target must be active OPERATOR/TECHNICIAN with ticket:read and live external eligibility. Rechecks IAM and approval after external I/O. |
| `infrastructure/mongodb/mongo-identity-mapping.writer.ts` under Ticket | Insert only inside an active Mongo transaction; both existing unique indexes include revoked mappings. No upsert, rebinding, delete/recreate or reactivation. |
| `src/platform/config/env.schema.ts`, `.env.example` | Optional `ZAMMAD_SERVICE_USER_ID` and JSON-array `ZAMMAD_NON_HUMAN_USER_IDS`; required/validated only when the opt-in user-access module is instantiated. |
| Three new `*.spec.ts` files beside provisioning and external adapter | 21 provisioning unit cases, 22 eligibility unit cases, 11 fake HTTP contract cases. |
| `test/ticket-identity-mapping.integration.ts` | Existing eight persistence cases plus four transaction tests; explicit replica-set preflight and synthetic fixture cleanup. |
| `test/zammad-user-access.real.ts` | Explicit read-only disposable-instance adapter probe. |

The provisioning authority port intentionally has **no production grant provider or unrestricted CLI**. Its eventual implementation must bind an authenticated operational session to the exact actor, reviewed pair, instance/group and approval reference; an actor-ID string alone is not authentication. This is a remaining operational composition gate, not an implemented administrator bypass. No human mappings were inserted. Revocation/reactivation remains a separately approved operational capability.

Mapping and `audit.fact` (`ticket.identity_mapping.created`) are committed atomically through existing platform UnitOfWork/Outbox ports. Tests prove durable outbox append and rollback, **not delivery into the Audit read API**. Actual provisioning must also verify downstream Audit receipt. Unknown commit outcomes require exact mapping/Audit readback before any retry. IAM/external checks are snapshots, not distributed locks or instantaneous revocation guarantees.

### Actual results

| Execution | Result |
| --- | --- |
| Focused Ticket Jest | **PASS: 132 tests, 8 suites** ? 100 unit and 32 fake-Zammad HTTP cases, including existing P1-A regression coverage. |
| Full Jest coverage run | **PASS: 620 tests, 109 suites**; local execution, not a completed CI run. |
| Mongo persistence/transaction runner | **PASS: 12/12** against Docker Mongo 8.0.38 replica set rs0 through IPv6 loopback. Commit, rollback after actual Audit append, revoked uniqueness and missing-transaction denial verified. |
| TypeScript including specs, repository non-mutating ESLint, production build | **PASS**. |
| Scoped TypeScript Prettier check | **PASS**. No repository-wide formatting rewrite; existing unrelated CRLF files preserved. |
| Real Zammad user adapter | **PASS** for users 4 and 5; each validates service 6 and direct group 2 full using GET only. Configured exclusions 1/6/7 return null locally; those exclusion checks are not fresh upstream mutation probes. |
| Real Ticket adapter | **PASS** Ticket 3, number 11003, group 2, native owner 5, customer 7, state 2, priority 2. |
| Running version | Container VERSION read returned **7.2.2-45de44f1.docker**. Existing token needed no privilege elevation. |
| Business Owner/custom-field and writer mutation matrix | **NOT RUN: separate approval absent**. No claim of field history, identity validation or writer isolation. |
| P1-B.2 resource authorization and Web/Mobile E2E | **NOT IMPLEMENTED / NOT RUN** while gates remain open. No business acceptance cases marked complete. |

Initial real-adapter bootstrap failed because `.env.local` omitted the group setting; rerun passed with the independently verified group supplied through process environment. Initial Mongo runs had 10/12 passing against a different standalone server at IPv4 localhost; they do not prove transaction rollback. Read-only hello checks identified the Docker replica set at `[::1]`; after correcting the test URI, all 12 passed, including an assertion that Audit append was actually reached before rollback. No database configuration was changed. Only synthetic test rows in the dedicated `_test` database were created and cleaned up.

Commands executed from `core-backend` (PowerShell; Node v22.22.3, existing installed repository dependencies):

```powershell
node node_modules/jest/bin/jest.js --runInBand --testPathPatterns=src/modules/ticket
node node_modules/jest/bin/jest.js --coverage --runInBand
$env:MONGODB_TEST_URI='mongodb://[::1]:27017/ar_imms_ticket_identity_test?replicaSet=rs0&directConnection=true'
node -r ts-node/register -r tsconfig-paths/register test/ticket-identity-mapping.integration.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.spec.json
node node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"
node node_modules/@nestjs/cli/bin/nest.js build
node node_modules/prettier/bin/prettier.cjs --check 'src/modules/ticket/**/*.ts' src/platform/config/env.schema.ts test/ticket-identity-mapping.integration.ts test/zammad-user-access.real.ts

# Non-secret values of the verified disposable fixtures only; credentials stay in ignored .env.local.
$env:ZAMMAD_EXPECTED_GROUP_ID='2'
$env:ZAMMAD_SERVICE_USER_ID='6'
$env:ZAMMAD_NON_HUMAN_USER_IDS='[1,6,7]'
$env:ZAMMAD_READ_TEST_EXPECTED_BASE_URL='http://localhost:8081'
node --env-file=.env.local -r ts-node/register -r tsconfig-paths/register test/zammad-user-access.real.ts
$env:ZAMMAD_READ_TEST_TICKET_ID='3'
node --env-file=.env.local -r ts-node/register -r tsconfig-paths/register test/ticket-zammad-read.real.ts
docker exec zammad-docker-compose-zammad-railsserver-1 cat /opt/zammad/VERSION
```

### Remaining approvals and release gates

1. **Provisioning/security owner:** approve authenticated operational authority implementation, exact instance generation/group and reviewer evidence for the two approved human pairs. Then run eligibility, atomic provisioning and Audit readback. Pair approval alone does not enable an arbitrary caller to provision.
2. **Business owner + Zammad administrator:** approve section 2's exact `arimms_business_owner_id` field and section 3's bounded disposable fixtures/migration/restart/rollback plan. Prove independent Owner/Assignee values, assignment preservation, read/update/history and missing/invalid identity behavior. No schema mutations were executed.
3. **Deployment/security owner:** approve and demonstrate enforceable Core-only writer access, restricted emergency administrator paths and denied Technician direct self-assignment/self-grant. Loopback publication alone is insufficient. Core authorization does not protect writes made outside Core.
4. **Integration owner:** execute approved revocation/invalidation probes for the version-bound direct-group contract; role-derived permissions remain unsupported. Service/non-human inventory requires operational review.
5. Only after those gates: implement P1-B.2 and its 17 requested technical authorization scenarios, including IT_ADMIN with inherited Ticket permissions, live ownership changes and Owner-or-Assignee visibility. The existing negative provisioning test excludes IT_ADMIN mapping targets; it is **not** proof of an unimplemented Ticket query's authorization.

The shared default-branch Flow 04 file was re-read through GitHub on 2026-11-19 (file blob `202bed2ebd8b361791540a003f583c78b222ae91`). It still mentions IT Admin business operations in expected outcomes, role table, BR-02 and manual creation. The user's newer two-role scope governs this implementation; [UC-63/64/67/68/72 and baseline correction requests](flow04-ticket-role-scope-correction.md) remain for document-owner approval. Shared files/submodule and IAM catalog were not changed. The [22-case inventory](../testing/flow04-test-matrix.md) and provisional BM04 commitments are unchanged; formal BM04 approval remains pending.

## 8. Approved local activation and bounded experiments ? 2026-11-20

### Mapping activation: completed

The user approved admin1 as the designated local provisioning administrator and the two exact pairs. `LocalProvisioningAuthority` now implements the existing authority port, disabled when no configuration is supplied. It accepts only explicit development configuration, unique approved pairs and exact instance/group scope, then authenticates the administrator afresh through an `OperationalActorPort`. It rejects administrator-as-target mappings, wrong actors/scopes/pairs and inactive/non-administrator principals. `user:manage` alone never grants authority. No administrator UUID is embedded in production code; no public administration endpoint exists.

Operational configuration is local and ignored: `.tmp/flow04-mapping-approval.json`. Scope: `arimms-p0-generation-1`, group 2, origin `http://localhost:8081`. Non-secret scope/service/exclusion settings were appended to ignored `.env.local`; credentials were preserved. The bounded executor `.tmp/flow04-activate-mappings.cjs` implements the operational authentication boundary with the existing public `/api/v1/auth/me` API and resolves principals/capabilities with `/api/v1/users/{id}`. It uses `ProvisionIdentityMapping`, `MongoIdentityMappingWriter`, platform UnitOfWork/Outbox and `MongoIdentityMappingStore`; it does not insert records directly. This local executor is not an enabled Core service or a production provisioning API.

Both users were revalidated ACTIVE, with their exact OPERATOR/TECHNICIAN roles, mandatory password change completed and baseline `ticket:read`; admin1 was authenticated ACTIVE IT_ADMIN with `user:manage`. Fresh external user/role probes confirmed exact users, active roles, named `ticket.agent` capability and direct group 2 full access. Forward/reverse lookups including revoked rows were empty before insertion. A dry-run passed before the explicit execution. Replica-set identity and the 12-case transaction suite were verified first.

| Core identity | Zammad | Mapping result | Creation Audit event |
| --- | --- | --- | --- |
| `403678c5-a90b-4a06-9a7d-318f27a3c639` | 4 | ACTIVE; scoped read-port readback passed | `ac8bad43-0b85-4051-b096-5cfa3abdaf30` |
| `53cd2a15-5221-4f49-a822-3c56e4cca637` | 5 | ACTIVE; scoped read-port readback passed | `802dc7b2-7e76-491c-b29c-b6bdc1b5b4b4` |

Both events were returned by **GET `/api/v1/audit/events`**, filtered by `resource_type=ticket.identity_mapping` and the exact serialized instance/Core-ID resource key. Action: `ticket.identity_mapping.created`; actor: admin1 `9c52d3fe-1bf7-4255-8654-6ec9c315070e`. Recorded at `2026-11-20T05:07:01.688Z` and `05:07:01.702Z`. This confirms Audit ingestion, not merely an outbox append. No admin1 or service identity mapping was created. Re-execution must reconcile exact existing mapping and Audit evidence; never delete/rebind or blindly retry an uncertain write.

### External eligibility: verified current contract and limits

Fresh credential checks: Zammad administrator 3, Technician 5 and Integration 6, all active. The administrator credential has the `admin` permission namespace; Technician and Integration each have an active role containing named `ticket.agent` and direct group 2 full. Role IDs were discovered from the API and looked up dynamically; no numeric role/permission IDs were introduced into business logic. The Integration credential was not changed or elevated.

The deployed `CanAssociations.attributes_with_association_ids` calls `group_ids_access_map`. `HasGroups.groups_access_map` requires activity and `groups_access_permission?`, which checks `permissions?('ticket.agent')`, before exposing active direct groups. Thus the implemented map test establishes version-specific Agent eligibility, not just membership. Expanded role reads independently corroborated current Agent capability for the approved identities. No weaker static-attestation policy was adopted; human nature still depends on explicitly approved provisioning and the configured non-human exclusions.

The serializer has caching. Immediate propagation after administrator role/permission changes is not proven by these read-only probes; existing user roles/groups were deliberately not modified. A production release must test invalidation or add a reviewed live role-change check. Do not treat mapping ACTIVE status as cached authorization; future queries must check current IAM, external eligibility and canonical ownership. Emergency revocation must disable affected access at an approved operational boundary and verify denial before claiming revocation; a mapping revoke/reactivation command remains outside this create-only implementation.

### Business Owner contract: demonstrated, not released

The original proposed `arimms_business_owner_id` was rejected with **HTTP 422**. Deployed `ObjectManager::Attribute` reserves custom names ending in `_id`/`_ids`; subsequent inventory confirmed no field or pending migration from that rejected attempt. The user explicitly approved **`arimms_business_owner`** instead. Earlier field-name proposals in this document are historical and must not be implemented.

Attribute **60** was created as Ticket integer, default null, nullable, min 1, max 2147483647, editable, initially active, optional in Agent create/edit screens, position 1550. Zammad normalized options with empty `options` and `relation`; neither is a foreign-key relation. Before creation/migration the administrator API showed no unrelated pending changes. Only the approved P0 Rails/server, scheduler and websocket containers were restarted after migration; databases and the port-8080 stack were untouched. See [official object API](https://docs.zammad.org/en/latest/api/object.html) for the supported object-management and migration routes.

| Executed probe | Actual observation |
| --- | --- |
| Dedicated Ticket 9, native assignment | Created in group 2 with Assignee 4, without a Business Owner value. Technician 5 directly PUT owner_id=5: **200**, canonical readback 5. Restored to 4. History 92 attributes the self-assignment to 5; history 94 attributes restoration to service 6. |
| Dedicated Ticket 10, create/read | POST with Assignee 5 and Business Owner 4 succeeded; both values read back independently. |
| Assignment change | Assignee 5 ? 4 preserved Business Owner 4. |
| Business Owner change | Business Owner 4 ? 5 preserved Assignee 4. |
| Direct Technician self-grant | With both responsibilities held by user 4, Technician 5 PUT Business Owner=5: **200**, readback 5. History 105 records creator 5. This is a demonstrated bypass, not approved business behavior. |
| Missing/null Owner | null accepted with 200; cannot infer a responsible Owner. |
| Malformed/range values | 0, -1, 2147483648 and `not-a-user` returned 422; previous value retained. |
| Invalid human identities | Customer 7, service 6, inactive system 1 and nonexistent 999999 each returned 200. Integer validation provides **no human referential or eligibility validation**. |
| History | Business Owner changes recorded scalar old/new values and actual Zammad actor IDs; service-written changes identify 6, not the originating Core human. |
| Restoration | Ticket 10 restored to Assignee 5 / Business Owner 4 after probes. Ticket 9 restored to Assignee 4. Existing Ticket 3's assignment/group/update timestamp remained unchanged. |

No inactive-human or wrong-group-human fixtures were created, and no existing users/roles/permissions were changed. Those identity negatives remain unexecuted live cases; system 1 is not a substitute for an inactive-human mutation test. No Core Ticket mutation use case was implemented. Zammad history is not a Core human-operation Audit record for these service-account experiments.

Rollback uses the approved **non-destructive disable**, retaining the field column, probe values and history. Attribute 60 was set inactive; its configuration was applied and the same P0 application containers restarted. Tickets 9/10 are retained as disposable evidence, not deleted or closed. Disabling field metadata is not an API security boundary.

Final `node .tmp/flow04-rollback-verify.cjs` passed at `2026-11-20T05:16:45Z`: attribute 60 inactive, no pending create/migrate/delete/config flags; Ticket 9 Assignee 4 / Owner null; Ticket 10 Assignee 5 / Owner 4; all 14 Owner history entries retained. Ticket 3 retained its original update timestamp, native Owner 5 and group 2 (new nullable field reads null). Several immediate post-restart reads returned 502 while Rails/scheduler/websocket restarted repeatedly. Read-only startup/source inspection found Zammad's version-monitor restart marker has a five-minute TTL (`lib/app_version.rb`); recovery without further configuration/data changes is consistent with that mechanism, not a proven cache root-cause diagnosis. Final readback succeeded after the transient cleared. No Redis/database reset or extra privilege change was used.

### Writer enforcement: failed gate

A disposable, credential-free container on Docker's default bridge reached `host.docker.internal:8081` **and** `:8082`. It was automatically removed (`docker run --rm`). Independently, an actual Technician PAT from the host successfully performed both unauthorized self-assignment and Business Owner self-grant on the dedicated fixtures. Loopback binding therefore does not establish Core-only writer enforcement for Docker-capable/local actors. This experiment is not proof about every physical LAN/client route; the real Web/Mobile network boundary has not been tested.

The host, Docker daemon and anyone who can read the ignored credential files are trusted administrative surfaces in the current PoC. Ordinary clients must not receive host shell, Docker socket, service credentials or direct upstream routes. Credential files remained ignored and no token was placed into the disposable network-probe container. Ignoring files alone is not a full credential-isolation attestation.

Required persistent deployment change for review: remove unrestricted upstream host publication; provide a service-authenticated Core-to-Zammad ingress and separately restricted administrative ingress; isolate backend containers from ordinary client/container networks; close alternate REST/UI/GraphQL/websocket paths. Validate from the actual client segment with both unauthenticated and Technician credentials, while confirming Core connectivity and unchanged canonical ownership on denial. Specify host/Docker-administrator trust, credential ACLs and emergency access procedure. No persistent firewall/network configuration or unrelated stack was modified in this experiment.

**P1-B.2 NOT IMPLEMENTED. P1-B.3 NO-GO.** Mapping activation and Owner storage behavior are verified, but the writer gate demonstrably fails. The tested field is disabled pending a safe deployment decision. Do not enable Technician visibility based on directly self-editable ownership/assignment. This is the approval boundary, not permission to weaken resource policy.

### Code, commands and test evidence

New code: `src/modules/ticket/infrastructure/local-provisioning-authority.ts` and its adjacent spec (15 cases). Local activation/probe scripts and sanitized receipts are under ignored `.tmp`; no credentials or operational human IDs were hardcoded into production authorization logic. Existing local architecture/README documents were updated; shared rules, IAM catalog and the 22-case inventory remain unchanged.

```powershell
node node_modules/jest/bin/jest.js --runInBand --testPathPatterns=src/modules/ticket
# PASS: 147 tests, 9 suites (115 unit, 32 fake HTTP; includes 15 new authority cases).
$env:MONGODB_TEST_URI='mongodb://[::1]:27017/ar_imms_ticket_identity_test?replicaSet=rs0&directConnection=true'
node -r ts-node/register -r tsconfig-paths/register test/ticket-identity-mapping.integration.ts
# PASS: 12/12, including transactional Audit append and rollback.
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.spec.json
node node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"
node node_modules/@nestjs/cli/bin/nest.js build
node node_modules/prettier/bin/prettier.cjs --check src/modules/ticket/infrastructure/local-provisioning-authority.ts src/modules/ticket/infrastructure/local-provisioning-authority.spec.ts
# PASS: types, lint, build, scoped formatting.
$env:ZAMMAD_READ_TEST_EXPECTED_BASE_URL='http://localhost:8081'
$env:ZAMMAD_READ_TEST_TICKET_ID='3'
node --env-file=.env.local -r ts-node/register -r tsconfig-paths/register test/zammad-user-access.real.ts
node --env-file=.env.local -r ts-node/register -r tsconfig-paths/register test/ticket-zammad-read.real.ts
# PASS: current users 4/5 and unchanged Ticket 3.
```

Operational evidence commands actually executed: `node .tmp/flow04-probe-identities.cjs`; `node -r ts-node/register -r tsconfig-paths/register .tmp/flow04-activate-mappings.cjs` (dry-run), then with `--execute`; `node .tmp/flow04-mapping-audit.cjs`; `node .tmp/flow04-owner-probe.cjs` with individual modes `install`, `migrate`, `assignment`, `field-tests`, `disable-field`, `apply-rollback`. These are receipt-guarded, one-shot local experiments; do not rerun mutation modes blindly. Field install first failed definitively for the reserved name; approved replacement then succeeded. Initial credential check had expired, and succeeded after the user supplied a refreshed token. No new full-repository coverage run or CI execution is claimed; section 7's 620-test run is historical. Business acceptance/E2E tests remain pending, formal BM04 approval remains pending.

## 9. Private deployment and internal P1-B.2 ? verified 2026-11-20

### Scope and implemented deployment

The user approved persistent changes only to the selected P0/Core stacks, trusted host/Docker administrators, synthetic revocation probes, and conditional P1-B.2 after representative-client verification. No physical or actual Web/Mobile client was available; the user explicitly allowed the representative network gate for internal implementation while retaining real-client checks before release.

Core is now containerized from repository source, pinned Node 22.22.3/pnpm 11.9.0 and the existing lockfile. `deploy/flow04/core.private.yaml` overlays the existing `core-backend` project, retaining its Mongo volume and rs0/member `localhost:27017`, removing Mongo publication, and exposing only Core 8082. `zammad.private.yaml` overlays the existing `zammad-docker-compose` project, preserving its volumes and removing port 8081. The selected Zammad backend network and Core data network are internal; no backend service is published. Core reaches `http://zammad-nginx:8080` using the unchanged Integration PAT. This plaintext origin is explicitly configured via `ZAMMAD_PRIVATE_HTTP_ORIGIN`; non-loopback HTTP remains rejected without exact-origin opt-in. A change of URL did not create new mappings or silently adopt another instance.

Maintenance uses a separate, normally stopped `admin.private.yaml` gateway. It runs non-root with dropped capabilities, read-only filesystem/tmpfs, server-verified TLS and a required maintenance client certificate; Zammad additionally requires the existing administrator PAT. It proxies API paths only. The trusted host owns CA/client private keys under an ignored ACL-restricted directory; only server credentials/public CA are mounted into the gateway. The gateway is **closed in the final state**. Integration credentials are injected at runtime, excluded from image build context and never supplied to the representative client.

See [deployment topology, executable startup script, certificate setup, maintenance and rollback procedures](../../../deploy/flow04/README.md). `manage.ps1` closes maintenance on normal startup, stops Core before opening maintenance, and closes maintenance before resuming Core. The initial isolated test kept Core up only to measure live revocation; there is still no public Ticket capability. No unrelated Docker stack, volume or shared infrastructure was modified.

### Preservation and same-instance evidence

- Existing selected-stack named volumes matched the saved pre-change inventory, including Mongo, PostgreSQL, Zammad storage and Elasticsearch.
- Mongo remains rs0 with original member `localhost:27017`; Core uses `directConnection=true` to reach it by Docker service name, with no replica-set reconfiguration.
- Version remains `7.2.2-45de44f1.docker`; service identity 6, group 2 named AR-IMMS-P0, attribute 60 and Tickets 3/9/10 match the approved generation `arimms-p0-generation-1`.
- Public IAM reads still return the same three accounts/IDs, ACTIVE statuses and baseline permissions. Both existing mapping rows are readable through their scoped port; admin1 has no mapping.
- Both original mapping Audit events remain returned through the public Audit API: `ac8bad43-0b85-4051-b096-5cfa3abdaf30` and `802dc7b2-7e76-491c-b29c-b6bdc1b5b4b4`. No repeat insertion or provisioning occurred.
- Ticket 3 retained its original update timestamp and Assignee 5; Ticket 9 retained Assignee 4 / Owner null; Ticket 10 retained Assignee 5 / Owner 4 and its history. No Ticket mutation was made during network denial tests.

### Actual writer-isolation acceptance

| Required check | Observed result |
| --- | --- |
| Core service connectivity and exact service identity | PASS: actual adapters inside Core read eligible users 4/5 (verifying users/me=6) and canonical Ticket 3 through private HTTP. |
| Existing Core API | PASS: representative client GET health/live 200; existing authenticated public IAM directory/detail and Audit reads succeeded after migration. |
| Ordinary UI/REST/GraphQL/WebSocket through old port | PASS: `/`, `/api/v1/tickets/10`, `/graphql`, `/api/v1/graphql`, `/ws` on host port 8081 unreachable. |
| Alternative selected upstream routes | PASS: direct private addresses for nginx:8080, Rails:3000, websocket:6042, PostgreSQL:5432, Redis:6379, Memcached:11211, Elasticsearch:9200 and selected Mongo:27017 all unreachable from the default bridge. |
| Restricted administrator path | PASS: valid maintenance certificate plus admin PAT read object definitions; Integration PAT via trusted maintenance read verified same instance/fixtures. |
| Technician self-assignment and Owner self-grant while gateway open | PASS denial: PUT owner_id=5 and arimms_business_owner=5 without a maintenance client certificate returned HTTP 400. No request reached Zammad; canonical values/history timestamps were unchanged. |
| Closed-by-default maintenance | PASS: gateway stopped; representative client could no longer connect to 8444. |
| Actual Web/Mobile / physical client | **NOT RUN**; explicitly unavailable, mandatory before deployment release. |

The client ran in a disposable container on `bridge`, not a trusted backend network. Its Technician credential was passed via stdin solely for the approved negative probes, not persisted, logged or distributed to application clients. The negative mTLS diagnostic intentionally did not validate the server certificate so it could specifically test absence of a client certificate; trusted maintenance reads did validate server CA/hostname. This diagnostic exception is not used by Core or normal clients.

A separate **unrelated native host Mongo listener** remains reachable through host port 27017: read-only hello reports no replica set and wire version 28, whereas selected Docker Mongo reports rs0/wire version 25 and has no published port. No unrelated data was read and that listener was not changed. The port-8080 Zammad stack is likewise outside this approval and untouched. These are explicit limits to whole-host hardening; obtain separate owner review before release rather than claiming every host service is isolated.

### Business Owner activation

Only after representative isolation and authenticated maintenance were demonstrated, existing attribute **60**, `arimms_business_owner`, was reactivated with the same nullable integer definition (1..2147483647). The object API showed no unrelated pending migrations. Its configuration was applied and only the selected Rails/scheduler/websocket application containers restarted. Subsequent reads confirmed active=true, preserved Ticket values and existing history. No duplicate field, global requiredness, fabricated backfill or parallel Core Owner store was introduced.

### Eligibility revocation and external writers

The approved synthetic Zammad users were **8** (inactive probe) and **9** (direct-group probe), distinct from Ticket IDs 9/10. Their Agent role was discovered by named permission `ticket.agent`, not a numeric role constant. Both initially passed the real Core external-user adapter. User 8 deactivation caused denial on the next read, measured 501 ms including mutation and adapter startup/read. User 9 direct-group removal caused denial on the next read, measured 606 ms. Restoration made each eligible again; final cleanup deactivated both and verified denial. No roles, permissions or group access of existing users 4/5/6 were modified. These are observed propagation timings, not a guaranteed revocation SLA.

Operational boundary: pause affected Core access before administrative identity, role, permission, group or ownership changes; apply the approved change, verify denial/eligibility and canonical context, close maintenance and resume only with fresh reads. No cross-request eligibility/ownership cache was added. Generic global-role permission-cache invalidation was **not** mutation-tested; do not claim it has the same timings. Such changes require the maintenance pause/verification procedure, not reliance on an ACTIVE mapping.

Read-only automation inventory through admin API: three triggers (one active new-ticket email notification; two disabled email notifications), zero ticket scheduler `/jobs`, zero core workflows. None of the configured trigger actions changes Owner, Assignee or state. The initially attempted `/schedulers` route was unsupported; the supported `/jobs` route completed inventory. Built-in Zammad scheduling/escalation and trusted administrators remain possible external writers; this is not a distributed lock or an exactly-once mutation guarantee. Every query reads current canonical data.

### P1-B.2 implementation

`GetAuthorizedTicket.execute(authenticatedUserId, ticketId)` is an internal, constructor-injected application query. A future trusted entry point must supply the authenticated ID; it must never accept a client-selected actor ID. No controller, public module API or CoreModule registration was added.

Sequence: validate input; resolve public IAM principal; require ACTIVE OPERATOR/TECHNICIAN and ticket:read; validate the active exact-scope forward mapping; validate current exact external identity/group eligibility; read canonical Ticket and enforce group; validate authoritative Business Owner and apply visibility. IT_ADMIN is rejected before mapping/Ticket reads regardless of inherited permissions. Extra capabilities never widen Technician visibility.

The Ticket adapter normalizes `arimms_business_owner` into a missing, invalid or positive-integer reference without coercion. Missing/malformed data is preserved as a repair status, not inferred from Assignee/customer/service. New narrow reverse lookup `findActiveMappingByExternalId` verifies both existing uniqueness directions and scope/status. Owner validity additionally requires a mapped ACTIVE OPERATOR/TECHNICIAN Core principal and current eligible external identity. Technicians need valid Owner data even when assigned. Permitted Operators may inspect missing/invalid Owner data for repair; dependency failures are never converted into allowed repair reads.

Result is `allowed` with selected external Ticket and Owner validation status, `denied`, or `not_found`; infrastructure failures retain safe fixed errors or a sanitized dependency error. Future public non-disclosing 404 mapping is **not implemented** here. No raw upstream credentials/body, canonical mirror, writes or cross-request cache were added. Per-request snapshots do not claim atomicity against concurrent administrative writes.

Changed implementation files: query and adjacent 46-case unit suite; Ticket read port/adapter and mapping tests; reverse mapping read port/store and tests; explicit private-origin config/provider wiring; real internal smoke runner. Deployment files under `deploy/flow04`, `.dockerignore`, `.env.example`, environment schema and the requested local docs are updated. IAM role catalog, public API contracts, CoreModule and shared submodule remain unchanged.

### Fresh executed verification

| Execution | Result |
| --- | --- |
| Full repository Jest coverage | **PASS: 696 tests, 111 suites**. |
| Focused Ticket Jest | **PASS: 208 tests, 10 suites** (173 unit + 35 fake HTTP; subset of full run, not additional unique business cases). |
| Mongo integration / transactions / reverse mappings | **PASS: 14/14** on dedicated `_test` database inside the private data network. |
| Real internal query with public IAM port, actual mappings and Zammad | **PASS:** Operator Ticket 10 allowed; Technician Ticket 10 allowed; Technician imported Ticket 3 denied; Operator Ticket 3 allowed for repair; IT_ADMIN Ticket 10 denied; administrator mapping absent. Trusted internal test actors, not HTTP-authentication/E2E evidence. |
| Real external-user/Ticket adapter and mapping/Audit readback | **PASS** over the new selected-instance route / existing public Core APIs. |
| TypeScript including specs, repository non-mutating lint, local production build, image build, scoped formatting | **PASS**. |
| Business acceptance / CI / actual Web/Mobile E2E | **NOT RUN** in this phase; 22-case inventory unchanged, BM04 formal approval pending. |

Initial verification caught a malformed-URL exception bypassing the sanitized config error; it was fixed with a parseability guard and regression tests. Initial source staging under `.tmp` caused duplicate Jest discovery; the staging copy was removed after checking its exact path, and builds now use host TEMP outside the repository. Final fresh runs above contain no duplicated staged suites. Gateway startup initially failed on private-key ownership and read-only temporary paths; final gateway uses certificate-owner UID 1000 and tmpfs for all temporary paths. No credential ACL was weakened.

Exact check commands (PowerShell, repository root):

```powershell
node node_modules/jest/bin/jest.js --coverage --runInBand
node node_modules/jest/bin/jest.js --runInBand --testPathPatterns=src/modules/ticket
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.spec.json
node node_modules/eslint/bin/eslint.js "{src,apps,libs,test}/**/*.ts"
node node_modules/@nestjs/cli/bin/nest.js build
node node_modules/prettier/bin/prettier.cjs --check 'src/modules/ticket/**/*.ts' src/platform/config/env.schema.ts test/ticket-identity-mapping.integration.ts test/ticket-authorization.real.ts test/zammad-user-access.real.ts
$repoRoot=(Get-Location).Path
docker run --rm --network arimms-p0-core-data-v1 -e 'MONGODB_TEST_URI=mongodb://mongodb:27017/ar_imms_ticket_identity_test?replicaSet=rs0&directConnection=true' --mount "type=bind,source=$repoRoot/test,target=/app/test,readonly" --mount "type=bind,source=$repoRoot/src,target=/app/src,readonly" --entrypoint node arimms-core-flow04:local -r ts-node/register -r tsconfig-paths/register test/ticket-identity-mapping.integration.ts
docker cp test core-backend-core-1:/app/test
docker exec -e ZAMMAD_READ_TEST_EXPECTED_BASE_URL=http://zammad-nginx:8080 core-backend-core-1 node -r ts-node/register -r tsconfig-paths/register test/ticket-authorization.real.ts
```

Sanitized operational evidence: `.tmp/flow04-network-evidence.jsonl`, deployment-before inventory, activation/revocation receipts, automation inventory; mutation scripts are one-shot and must not be rerun blindly. The tracked `deploy/flow04/probe-client.cjs` consumes test inputs on stdin and emits sanitized checks. The ignored orchestration helper `.tmp/flow04-network-client.cjs` discovers current selected private addresses and supplies the test Technician token without command-line exposure.

**Recommendation:** GO for P1-B.3 planning/code review and a separately authorized implementation, based on this local representative gate; **do not start it automatically**. **NO-GO for deployment release** until actual client-network/Web/Mobile acceptance, remaining business/E2E commitments, source review and unrelated host-listener ownership review are completed. P1-B.3/public endpoints are not implemented.

## 10. Docker DNS recovery — verified 2026-11-20

Core was attached to `arimms-p0-core-data-v1`, while MongoDB's `mongodb` alias was on `core-backend_default`. A DNS lookup inside Core returned `ENOTFOUND`. MongoDB's healthy status came from its in-container replica-set check. The selected Zammad proxy also had its original 8081 binding. Both observations match the unoverlaid Compose configurations.

Reapplying the secure topology restored both paths. `compose.yaml` now defines the private Mongo network and alias without a published port. Host development uses a separate Compose project and volume. The [startup script](../../../deploy/flow04/manage.ps1) reapplies the selected Zammad overlay, verifies the upstream network and port bindings, waits for readiness, and authenticates the private Zammad service account. See the [startup and maintenance runbook](../../../deploy/flow04/README.md).

| Recovery check | Observed result |
| --- | --- |
| Compose and startup | Both Core configurations passed `config --quiet`. The prior `docker compose -p core-backend -f compose.yaml up -d --wait mongodb` command retained healthy secured Mongo. `manage.ps1 -Action Start` passed twice after the fix. Windows reboot was not exercised. |
| Docker DNS and replica set | Core resolved `mongodb`. Its Mongo driver reported writable `rs0`, sessions, and the existing `localhost:27017` replica-set member. |
| Transactions | 14/14 integration tests passed in the dedicated test database using the section 9 command, including mapping and Audit outbox commit and rollback. |
| HTTP and IAM | `/health/ready`, `/api/docs` (Swagger HTML), and `/api/docs-json` returned 200. The expired token returned 401. After refresh, `/api/v1/auth/me` authenticated `admin1`; all three active IDs and roles and both existing mapping Audit events were read back. |
| Zammad isolation | Core authenticated as service 6 on the private route. The disposable bridge client reached Core and could not connect to the former 8081 port, private proxy, or stopped 8444 gateway. The unrelated 8080 proxy retained its ID, start timestamp and bindings. |
| Data and P1-B.2 | Named mounts matched. The real internal query smoke passed again with the approved mappings and admin denial. Tickets 3/9/10 retained their ownership and update timestamps. Ticket 10 retained all 14 Business Owner history entries. |

The 22-case inventory is unchanged (SHA-256 `b347a91daea9947c156267fa9a48289e4bc30d229d2f7f9c75db7a6087c320da`). Actual Web/Mobile acceptance remains pending. P1-B.3 remains at its separate approval boundary.

Follow-up verification on the recovered deployment passed all 208 focused Ticket tests in 10 suites using the section 9 command. The real internal P1-B.2 smoke passed again. The live Swagger OpenAPI document contained no public Ticket paths, and inspection confirmed both upstreams still had only private attachments and no host port bindings. The broader section 9 results are from the original implementation run.

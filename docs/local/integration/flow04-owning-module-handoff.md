# WF-04 handoff to Incident, Maintenance and IAM owners

The current PoC has a callable Asset lookup and no public Incident or Maintenance provider. The Ticket composition accepts an optional `TICKET_WORKFLOW_LINKS_PORT` binding. Until the owning modules are imported and bind the reviewed adapter, draft submission and setting a new Incident link fail closed with HTTP 503. Reading links continues to return only confirmed, authorized references. Clearing a local Incident link does not require a live Incident lookup. [Ticket-side port](../../../src/modules/ticket/application/ticket-workflow-links.port.ts)

Final acceptance confirmed the missing-provider responses over authenticated HTTP on 2026-11-21 for reviewed draft submission, creation with an Incident ID, and adding a primary Incident link. The rejected link change left the existing Ticket unchanged. The Asset-maintenance port available in this repository changes Asset state through its owning workflow. It does not establish the identity, eligibility or visibility of a Maintenance Activity. No module uses that port as a substitute for the required Maintenance contract. [Live evidence](flow04-backend-completion.md#final-backend-acceptance)

## Confirmed Incident and reviewed draft

- Expose actor-aware lookup by immutable `incidentId`. Return the identity and eligibility only when the Incident is Confirmed and visible to that Core actor. Distinguish operational failure from an ineligible or unavailable reference at the port boundary. Do not fall back to direct persistence, email or inferred state.
- Expose actor-aware reviewed draft lookup by immutable `draftId` and exact `revision`. A stale, superseded, unreviewed, unauthorized or nonexistent draft is ineligible. A new revision requires explicit confirmation. Core must check the Operator's current `ticket:create` permission as well.
- Return the Confirmed Incident ID, approved title, plain description, zero or more immutable Asset IDs, and approved provenance/evidence references. The existing seam covers the first four payload fields. Agree and version the evidence reference shape before enabling real UC-64; no private Incident snapshots or raw Zammad payloads.
- Agree a stable cross-actor confirmation identity keyed by draft and exact revision, or an atomic owning-module claim answering whether the draft already has a canonical Ticket. The current actor-scoped operation journal and same-key retry do not alone prevent two different Operators confirming the same draft. A repeated successful confirmation should resolve to the same authorized canonical reference. A conflicting confirmation fails closed. A claim with an uncertain outcome cannot trigger automatic reissue.
- Define freshness checks while preparation is in progress, supported concurrency, and recovery of a verified external Ticket reference after a partial commit. Establish results for already confirmed, stale, unavailable dependency and unauthorized visibility without leaking another actor's Incident/draft. Persist the primary Incident reference once; lifecycle updates stay in each owning module.

Acceptance needs a real reviewed Confirmed-Incident draft, a stale revision, an unauthorized actor, concurrent or duplicate confirmation, restart recovery, provenance readback and proof that neither Ticket creation nor closure implicitly transitions Incident. Current UC-64 remains **BLOCKED**.

## Maintenance and business links

- Provide an approved actor-aware public query by immutable `activityId` and expected canonical Ticket reference `(instance, group, ticketId)`. Verify the owning activity workflow permits the reference and the actor can access it. A returned association for another Ticket is ineligible.
- Provide lifecycle-independent reference semantics for active, historical, retired, inaccessible, missing and unavailable activities. If an activity remains valid historical evidence, the owning contract should say which minimal fields and reference ID can still be returned. Preserve access controls when reading links.
- Dependent workflow calls Ticket's bounded attachment path with a stable operation identifier, approved actor and immutable Activity ID. Ticket validates the relationship, deduplicates references and commits link plus Audit through the journal. Confirm separate service/actor authorization with the Maintenance owner before accepting machine-originated handoff. The current path expects an authorized Operator.
- Confirm the error contract, retention rules, maximum link counts and revision/idempotency behavior. Do not make linking or completion of a Maintenance Activity change canonical Ticket lifecycle. Ticket closure or reopening does not change Maintenance state or Asset lifecycle.

Acceptance needs a real eligible related activity, an inaccessible activity, wrong Ticket or scope, duplicate delivery and verification that the independent lifecycles retain their states. Asset-only support is **READY** at the backend boundary. Incident and Maintenance parts of UC-72/73 remain **BLOCKED**.

### Provider review checklist

Agree on these application-port outcomes before binding either provider into the Ticket module. The names below describe proposed outcomes. They do not add a public HTTP API or change the current fallback.

| Operation | Minimum request and successful outcome | Negative and recovery evidence |
| --- | --- | --- |
| Confirmed Incident lookup | Current Core actor and immutable `incidentId`. Return the same visible Confirmed Incident identity. | Wrong actor, stale lifecycle and nonexistent reference produce no eligible link. An unavailable provider produces a dependency failure. |
| Claim reviewed draft | Current Operator, immutable `draftId`, exact revision and stable operation ID. Return canonical confirmed Incident identity and approved title, description, Asset references and evidence references. | Have the Incident owner choose the atomic claim contract. For the same draft and revision across different Operators, return the authorized existing canonical reference after confirmation, or a conflict while the first claim is outstanding. Never dispatch a second Zammad create after an ambiguous response. |
| Confirm or reconcile draft | Existing claim plus verified canonical `(instance, group, ticketId)`. Completion is repeatable for the same canonical reference. | Test interruption after Zammad acceptance and before claim completion. Resume from the verified reference. Distinguish conflict from unavailable dependencies and preserve both lifecycles. |
| Validate and attach Maintenance activity | Current authorized actor, immutable `activityId`, full canonical Ticket reference and stable operation ID for attachment. | Test wrong Ticket/instance, inaccessible or retired activity, historical link reads and duplicate delivery. If Maintenance initiates attachment as a service, agree the permitted service identity and audit attribution before binding it. |

Supply disposable fixtures for one authorized and one unauthorized actor, one matching and one mismatched revision or Ticket reference, and a dependency failure case. Ticket retains the existing 503 behavior until the reviewed providers and cross-module tests are available. Client integration uses the public Ticket API and does not call the future provider ports directly.

### Provider handover and fixture evidence

For Incident, provide the public module export and a versioned request/result contract, plus fixture IDs for a visible Confirmed Incident, an ineligible Incident, a current reviewed draft and a superseded revision. Agree a cross-actor duplicate claim and completion-recovery contract before binding the port. Demonstrate real Ticket creation with the approved evidence references, and unchanged Incident state after Ticket closure and reopening.

For Maintenance, provide the public module export and authorized Activity lookup or attachment contract with the full canonical Ticket scope. Supply valid, unauthorized, wrong-Ticket and historical Activities with expected visibility and errors. Demonstrate duplicate attachment recovery and show that completing Maintenance leaves the Ticket unchanged. Read links as both a currently authorized actor and a denied actor.

Share only fixture IDs, state expectations, owner and expiry in the manifest. Execute the real fixture plan in approved staging after both providers are bound. [Fixture manifest and staging criteria](../testing/flow04-ci-runbook.md#fixture-manifest-and-cleanup)

## IAM owner review

The business-approved target baseline is Operator `ticket:read/create/manage/work/close` and Technician `ticket:read/work`. `ticket:work` gates only the three non-terminal transitions and internal note append. Current authoritative ownership, role, IAM permission, mapping and Zammad eligibility remain mandatory. IT_ADMIN remains excluded in Ticket even if IAM's existing all-catalog baseline includes the new code.

The approved patch covers the IAM catalog, role baselines, capability description, OpenAPI and regression tests, plus the Ticket guards, workflow checks and Swagger metadata. [Exact changes and approval](review/flow04-ticket-work-approval.md) · [Rollout evidence](flow04-backend-completion.md#approved-ticketwork-rollout)

Legitimate test sessions were supplied for all three users and verified through `/api/v1/auth/me`, so no password reset or session revocation is needed now. If an approved PoC recovery is needed later, use an authenticated `user:manage` administrator and ask explicit authorization before invoking `POST /api/v1/users/{user_id}/reset-password` for the specific immutable local account. That operation revokes its old sessions and returns a one-time temporary credential with `must_change_password=true`. Deliver it through a protected channel, use normal `POST /api/v1/auth/login`, and perform `POST /api/v1/auth/change-password` with the temporary password as `current_password` and the new credential as `new_password`. Verify `/api/v1/auth/me` reports the same immutable ID, expected role and no required password change. Store only short-lived access tokens in the Git-ignored file. Do not change mappings, use a direct database update, or alter ACLs. [IAM API contract](../../../api/v1/iam.yaml)

# WF-04 human role correction and shared-document change request

Date: 2026-11-19. Local authorization direction approved by the user. Shared baseline/use-case edits below are **proposals for document-owner approval**, not applied edits. No IAM catalog change or P1-B.2 implementation.

## Effective local business rule

Only System Monitoring Operator (OPERATOR) and Maintenance Technician (TECHNICIAN) participate in Ticket business operations. Current active IAM identity and required capabilities remain necessary, but are insufficient on their own.

- OPERATOR: management-scope access only inside the explicitly approved group, subject to required IAM capabilities.
- TECHNICIAN: current authoritative Business Owner OR Assignee visibility. Additional permissions do not broaden visibility into Operator scope.
- IT_ADMIN: deny every Ticket business operation, even with ticket:read/create/manage/close, an accidentally present mapping, or a claimed Owner/Assignee relationship. Check the current public IAM principal's role before fetching a Ticket or performing business side effects. A role change from OPERATOR/TECHNICIAN to IT_ADMIN revokes business eligibility on the next observed check even if the mapping remains ACTIVE.
- Closure: eligible current Ticket Owner only, with required IAM permission and transition preconditions. Assignment alone does not grant closure. IT_ADMIN cannot close even if mistakenly referenced as Owner.
- Reopen: eligible current Ticket Owner OR OPERATOR with ticket-management permission, subject to existing capability/state checks. No IT_ADMIN override.
- Service credential: technical execution only, never a human principal or substitute for caller authorization.

Do not remove Ticket permissions from IAM's IT_ADMIN catalog. Enforce the Ticket-specific actor constraint in the future Ticket policy/use case, independent of the generic permission guard. Both HTTP and future non-HTTP business entry points must use that policy; denying solely because admin1 lacks a mapping is insufficient.

## Approved identity pairs and administrative separation

| Core human | Immutable Core ID                    | External Zammad ID |
| ---------- | ------------------------------------ | ------------------ |
| OPERATOR   | 403678c5-a90b-4a06-9a7d-318f27a3c639 | 4                  |
| TECHNICIAN | 53cd2a15-5221-4f49-a822-3c56e4cca637 | 5                  |

Only these two pairs are approved. Approval of their identity association does not authorize this documentation task to insert records. No mappings were inserted. No mapping may be created for admin1 (`9c52d3fe-1bf7-4255-8654-6ec9c315070e`) or Zammad Integration account 6.

Admin1 may administer IAM and perform explicitly authorized local integration provisioning. Its IAM capability, authenticated operational context and specific provisioning approval must be recorded separately from the target human's business eligibility. Provisioning Audit actor=admin1 is not an Owner assignment, identity binding or Ticket access grant. The future restricted provisioning path must verify that targets are one of the approved eligible-role pairs; the P1-B.1 data/read foundation does not itself implement IAM role checks.

Privileged Zammad support remains an out-of-band technical maintenance operation with approval/audit and controlled writer access. It must not be presented as an AR-IMMS Ticket business override. If an emergency technical change alters Ticket state/ownership, record it as an administrative exception and reconcile before resuming normal operations; do not claim it followed the Owner-only business workflow.

## Negative authorization specifications - planned, not executed

These are implementation subcases under existing TC-WF04 IDs, **not new unique BM04 cases**. The 22-case inventory is unchanged. No executable Ticket authorization use case/controller exists yet, so do not use passing IAM permission tests as evidence these policy tests pass. Implement the following assertions with P1-B.2 and the applicable later mutation phases, not in this documentation change.

| Technical subcase         | Setup and action                                                                                                                        | Required result                                                                                                          | Existing traceability                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| admin.read.inherited      | Active IT_ADMIN with ticket:read requests detail; inject a valid mapping and same-group Ticket so missing mapping cannot explain denial | Ticket application rejects business actor; HTTP 403 when exposed; no Ticket/user-access outbound read and no Ticket data | TC-WF04-20                                           |
| admin.read.owner          | Same administrator artificially appears as current Business Owner or Assignee in policy fixture                                         | Deny despite responsibility match and permissions; do not provision a real admin mapping to run this test                | TC-WF04-20                                           |
| admin.create              | IT_ADMIN has ticket:create and valid mocked integration scope                                                                           | Deny before any Zammad create, context write, receipt or business audit success                                          | TC-WF04-03                                           |
| admin.assign              | IT_ADMIN has ticket:manage; attempts assignment/reassignment                                                                            | Deny; no Zammad assignment/Owner modification                                                                            | TC-WF04-06                                           |
| admin.close               | IT_ADMIN has ticket:close, with both non-Owner and apparent-Owner variants                                                              | Deny both variants; no transition and no override                                                                        | TC-WF04-07; preserves TC-WF04-16 positive Owner case |
| admin.reopen              | IT_ADMIN has ticket:manage and appears as Owner                                                                                         | Deny; no reopen request                                                                                                  | TC-WF04-08                                           |
| admin.work                | IT_ADMIN has every existing Ticket capability, attempts progress/Article update                                                         | Deny; no Article append or status update; do not invent ticket:work                                                      | TC-WF04-20 supporting 05/22                          |
| admin.provision.isolation | Admin1 successfully performs an approved mocked mapping administration action, then requests Ticket business data                       | Administration success does not grant subsequent Ticket access; no automatic admin binding                               | TC-WF04-20                                           |
| role.changed.to.admin     | Previously eligible mapped human becomes IT_ADMIN; mapping remains active                                                               | Current IAM role wins over stale mapping/token claims; deny before external data exposure                                | TC-WF04-20                                           |
| technician.additional     | Technician gains existing extra Ticket permissions in a fake principal and requests an unrelated Ticket                                 | Still resource-invisible; no Operator-scope widening                                                                     | TC-WF04-20                                           |

Unit tests should use fake public IAM/mapping/transport ports and assert zero external calls on the role-rejection branch. HTTP integration must use the real IAM guards: inherited permission may pass the coarse gate, but Ticket application rejects. Existing route error conventions apply; IT_ADMIN role rejection is a generic caller-level 403, distinct from a permitted Technician's non-disclosing resource 404. For mutation phases also assert zero business writes and zero success events. Control cases retain authorized OPERATOR group reads, TECHNICIAN Owner-only and Assignee-only reads, eligible Owner closure, and Owner/authorized-Operator reopening.

No public list/history/Article route may later bypass the actor allowlist. Add equivalent IT_ADMIN denial when each such route exists; do not create endpoints or change IAM catalog solely to exercise these specs now.

## Shared Flow 04 baseline amendments requested for approval

Reviewed immutable source: [business/04-ticket-management.md at 294001cd](https://github.com/AR-IMMS/shared-docs/blob/294001cd9f1359bc03ced3925328454cabb3c0ea/business/04-ticket-management.md). The current baseline explicitly allows IT Admin business creation/management, which conflicts with the user's correction. Local design follows the latest user decision; the shared source is left unchanged pending document-owner approval.

| Exact location                              | Proposed amendment                                                                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary actors / section 4                  | Describe two human system roles only. Ticket Owner and Assignee are responsibilities of eligible actors. Move IT Admin to administrative/support context, explicitly outside Ticket business operations.                           |
| Section 2 first outcome                     | Replace Operator-or-authorized-IT-Admin creation with authorized OPERATOR creation.                                                                                                                                                |
| Section 3 boundaries                        | State IAM/integration administration does not confer Ticket business authorization.                                                                                                                                                |
| BR-02                                       | OPERATOR may create only with required IAM permission; IT_ADMIN is excluded regardless of inherited permissions. Manual creation still does not require Incident.                                                                  |
| BR-03 / section 7.2 confirmation            | Require an eligible authorized business actor; where confirmation creates a Ticket, enforce OPERATOR creation authority. No change to Incident review/confirmation prerequisites.                                                  |
| BR-04 / section 7.3 step 1 / OD-02          | Clarify permitted Ticket manager means OPERATOR with required capability, not IT_ADMIN; preserve separate Owner/Assignee responsibilities.                                                                                         |
| BR-05 / section 7.3 closure / OD-03         | Preserve current Owner-only closure and required permissions; explicitly exclude IT_ADMIN. Replace ambiguous potential override wording with no override in the approved scope; any future scope amendment is a separate decision. |
| BR-06 / section 7.4 / OD-04                 | Preserve current Owner OR authorized OPERATOR reopen, within eligible human roles. No admin bypass.                                                                                                                                |
| Section 7.1 step 1                          | Authorized OPERATOR opens manual creation.                                                                                                                                                                                         |
| Section 8 exceptions                        | Add IT_ADMIN with inherited Ticket permissions: reject business operation and perform no canonical/business mutation.                                                                                                              |
| F4-REQ-01 / OD-01                           | Replace Operator/Admin creation with authorized OPERATOR creation and explicit IT_ADMIN-negative acceptance.                                                                                                                       |
| F4-REQ-03/04/05/06                          | Add role eligibility to read/manage/close/reopen acceptance without changing lifecycle transitions or ownership semantics.                                                                                                         |
| Section 10 / integration identity decisions | Technical service account is not human actor; mapping provisioning authority is independent; only approved Operator/Technician bindings, no admin1 mapping.                                                                        |

No change requested to Zammad canonical ownership, Articles, links, ambiguous-outcome recovery, independent lifecycles, or the five baseline transitions. BA/business owner should update the shared baseline version and affected actor diagrams after approval; do not change the Git submodule pointer as part of this task.

## UC-63, UC-64, UC-67, UC-68 and UC-72 change requests

The authoritative UC texts were not found in local docs or the connected shared-docs tree (both the accepted revision and current tree inspected). Their titles, exact operation assignments and existing steps are therefore **not asserted** here. Supply the approved SRS/use-case source for a line-level patch. The following ID-specific review requests can be approved in principle without inventing those texts:

| Use case | Required actor/precondition/exception review                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UC-63    | Remove IT_ADMIN wherever a Ticket business actor or permission-only bypass is admitted; constrain actors to OPERATOR/TECHNICIAN according to the operation's existing business rule; add inherited-admin-permission rejection.                        |
| UC-64    | Apply the same two-role actor boundary and require current IAM identity, operation capability and approved resource scope; remove admin fallback or alternate success flow.                                                                           |
| UC-67    | Separate administrative/support participants from business actors; exclude IT_ADMIN from business success paths even if referenced as Owner/Assignee; preserve the operation's responsibility checks.                                                 |
| UC-68    | Add explicit deny branch for IT_ADMIN and prohibit side effects; if this UC governs closure/reopening, retain Owner-only closure and Owner-or-authorized-Operator reopen exactly, without assigning an unverified title to the UC.                    |
| UC-72    | Ensure any Ticket integration/service/provisioning participation does not grant human business access; exclude IT_ADMIN from Ticket operations while retaining explicitly authorized non-business IAM/provisioning responsibilities where applicable. |

For each UC, BA must inspect actor associations, preconditions, main/alternate flows, postconditions and test traceability. If a UC is solely administrative, retain its legitimate IT_ADMIN actor and state explicitly that it confers no Ticket business permission. Do not indiscriminately remove IAM administrators from unrelated administrative use cases. Actual UC text is required to resolve this classification and finalize changes. Owner-only closure/reopen amendments above apply wherever those operations occur, not based on guessed UC numbering.

## Approval and implementation boundary

Local correction and two pairs: approved by user. Shared Flow 04/UC edits: proposed for BA/business-owner approval. IAM catalog: unchanged. Mapping insertion tooling/authority, Business Owner field/writer enforcement and P1-B.2 implementation: still gated. This update adds local documentation/test specifications only; no application authorization tests or business operations executed.

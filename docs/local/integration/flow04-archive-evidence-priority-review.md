# WF-04 Archive, Evidence and Priority extensions

**Technical-owner review required.** This proposal and implementation are for review. The existing Pod/Compose stacks, secrets, identities, public IAM catalog, and historical Tickets are outside this change.

## Contract and authorization

| Route relative to /api/v1/tickets | Capability and behavior |
| --- | --- |
| GET /metadata/priorities | Scoped Ticket reader. Core reads active Zammad priorities and returns id, label and color. Unknown or inactive priorities remain neutral in UI. |
| GET /eligible-users | Scoped Operator with ticket:read and ticket:manage. Searches eligible people by IAM username or display name, with cursor pagination. |
| GET /archived | In-scope Operator with ticket:manage and ticket:read. Cursor list returns canonical Ticket detail plus current archive snapshot. |
| POST /{ticket_id}/archive | Same Operator gate. Required reason, 1–500 characters, and stable Idempotency-Key. Preserves canonical Ticket. |
| POST /{ticket_id}/restore | Same Operator gate. Required reason and independent operation key. Moves the same canonical ID back into ordinary visibility. |
| GET /{ticket_id}/evidence | Current resource reader. Archived Ticket reads require the authorized Operator management path. Returns items, next_cursor and upload_available (storage configuration availability). |
| POST /{ticket_id}/evidence/uploads | Current Ticket worker with ticket:work. Issue a signed ten-minute upload grant scoped to actor, Ticket, deployment and proposed file. |
| PUT /{ticket_id}/evidence/uploads | Same resource and work checks, X-Evidence-Grant, application/octet-stream. Writes an immutable private stage object, allowing byte-identical retries. |
| POST /{ticket_id}/evidence/finalize | Current worker and stable Idempotency-Key. Verifies object and commits Evidence metadata and Audit. |
| POST /{ticket_id}/evidence/{evidence_id}/access | Current reader requests inline (image) or attachment access. Read grant expires in 60 seconds. |
| POST /{ticket_id}/evidence/{evidence_id}/content | Current reader, signed read grant and integrity check. Core streams image or download bytes with private no-store, nosniff and sandbox CSP. PDF is attachment-only. |

Archive is independent of NEW, OPEN, PENDING and CLOSED. Ordinary detail, lists, Articles, links and workflow mutations use the default resource gate and conceal archived Tickets. Restore evaluates current canonical Owner/Assignee eligibility, so historical responsibility does not grant access. Archive and Restore never call a Zammad mutator. Existing journal and Audit receipts remain durable.

The source deployment returned Low (ID 1), Normal (ID 2) and High (ID 3) through the existing service account. No active Critical priority was observed. Colors derive from upstream metadata instead of numeric IDs. The catalog is read-only and permissions are unchanged.

## Persistence and migration

- **ticket_archives** has one row per (instance, group, canonical ticketId), with a unique composite index and a secondary (instance, group, active, ticketId) index. A version check protects transitions. Archive and Restore reasons and actors are retained in the corresponding state row and Audit.
- **ticket_evidence** has unique (instance, group, ticketId, id) and (instance, group, ticketId, sha256) indexes. It stores normalized file name, declared/validated MIME type, size, digest, uploader and date. The file key is a deterministic hash of deployment scope, Ticket and generated Evidence ID. It is omitted from public responses.
- The Ticket module initializes indexes using the existing journal store convention. Existing Tickets begin active when there is no archive row, and existing Ticket business-context documents need no backfill. The ownership team should verify index builds on a staging backup before activating.
- The existing sparse operation lock serializes both local extensions and workflow writes by canonical Ticket scope. The journal's verified checkpoint, the archive or Evidence change, the audit sequence and Outbox commit follow the existing protocol. The final transaction commits local changes, receipt completion and Audit together. Archive and Evidence finalization can recompute a dispatching checkpoint because their preparation makes no external write. Same-key replay adds no duplicate Audit. A pending prior write lock still blocks competing operations, including Archive of a quarantined Ticket.
- Normal lists retain the existing bounded upstream scan. An unusually dense span of concealed/archived candidates can exhaust the scan budget and return 503. Review deeper pagination before operating at high archive volume.

## Evidence operational gate

The current adapter is an immutable filesystem implementation behind the Ticket storage port. To activate on a dedicated single-node test deployment, provision an absolute private directory outside any static/web root, mount it read/write to the Core service only, and use owner-only filesystem permissions. Set both TICKET_EVIDENCE_DIRECTORY and a distinct TICKET_EVIDENCE_SIGNING_KEY (32+ characters) via approved secret/config injection. Omitting both disables new uploads. No vendor storage or credentials are bundled. A shared private storage adapter is required before multiple app instances can serve Evidence reliably across hosts.

Core accepts PNG, JPEG, WebP and PDF up to 8 MiB per object. It checks size and byte signatures/container characteristics and bounds supported image dimensions. It performs no malware scanning. The owner must choose scanning, retention, orphan reconciliation, backup and quota policies before release. Partially written temporary files are unlinked. Successfully staged but unfinalized objects, including duplicate attempts, stay inaccessible and need an approved cleanup process. Archive/Restore neither moves nor deletes files. A signed upload grant expires for writing after ten minutes. An active same-actor client can resume finalization against the immutable staged bytes for up to 24 more hours. Reauthorization is required on each use. Preserve the original operation key for ambiguous finalization.

Rollback should pause Ticket writes, retain archive/Evidence collections, storage and journal/Audit records, and preserve writer isolation. Rolling back to a pre-archive binary would cause archived Tickets to appear active. Do not use that rollback until a compatibility plan preserves the archive gate.

## Verification path

Run the backend Jest/typecheck/build checks, Redocly validation, and the private disposable replica-set runner in the existing CI runbook. Run the frontend Ticket contract tests and browser mock runner. For staging, approve the schemas/storage, verify fresh IAM sessions, use disposable Ticket and Asset fixtures, then exercise create/assign/work/Article, upload and protected read, archive, exclude from ordinary routes, restore and verify canonical identity/history/Evidence. Historical Ticket 3 and quarantined Ticket 11 have no role in this procedure.

### Executed local evidence

| Layer | Command | Result |
| --- | --- | --- |
| Backend Jest, including Nest HTTP and fake-Zammad contracts | `pnpm.cmd test --runInBand` | 750 tests passed across 116 suites. |
| Disposable MongoDB replica set | `node test/wf04-ci-mongo.cjs --build` | Passed mapping indexes and transaction scenarios, including Archive rollback when Audit fails, same-key replay, concurrent Restore rejection, successful Restore and Evidence retention. |
| API descriptions | `pnpm.cmd exec redocly lint --extends spec api/v1/ticket.yaml api/v1/iam.yaml` | Both specs passed. |
| Frontend Ticket contract tests | `pnpm.cmd test:ticket` | 9 passed. |
| Edge against mocked Core | `node tests/wf04-ticket-browser.mjs` with the documented isolated browser variables | Passed create, retries, role restrictions, work, Article, PNG/PDF bytes and retrieval, archive and restore. |
| Configured Zammad PoC, read only | `GET /api/v1/ticket_priorities` through the existing private service path | HTTP 200, Low 1, Normal 2, High 3. |
| Live secured browser and extended Core with private Evidence storage | Staging procedure above | NOT RUN. Requires technical-owner approval, configured storage and fresh authorized sessions. |

[OpenAPI](../../../api/v1/ticket.yaml) · [CI runbook](../testing/flow04-ci-runbook.md)

## Priority deployment diagnosis and eligible-user directory

On 2026-11-23 Core on port 8082 returned 200 for readiness and runtime OpenAPI, 401 for unauthenticated Ticket list and 404 for the priority route. Runtime OpenAPI lacked the new metadata and Archive/Evidence routes. The frontend configured `http://localhost:8082` as its Core origin. A GET preflight from `http://localhost:3000` returned 204 with the matching Access-Control-Allow-Origin and Authorization allowed, so it did not explain the missing route. The running container used the previous image. A read through the existing private integration path returned the three active Zammad priorities. The stored Operator, Technician and IT Admin bearer sessions returned 401 from IAM.

The new directory composes the Ticket mapping store's bounded candidate enumeration with a narrow internal IAM profile projection. Its supporting index is (instanceKey, approvedGroupId, status, _id). After scoped Operator authorization, the query limits candidate enumeration to 50 mappings per request, and the cursor can advance when a page contains no matches. The response exposes the eligible Core UUID, username, optional display name, role and ACTIVE status. Email, mapping audit fields and Zammad identifiers stay out of the response. Both responsibilities currently use the same approved eligibility policy independently. Live IAM, mapping, external account and group eligibility are rechecked on submission. There are no new IAM grants.

The updated Core image was started in a disposable, unexposed container with its own temporary Mongo replica set, synthetic IAM accounts and short-lived fixture sessions. The container used the approved private Zammad connection for reads of the current catalog and human eligibility. The fixture performed no Ticket mutations and no changes to the persistent PoC deployment.

- Actual HTTP 200, priority data `[{"id":1,"label":"Low","color":"green"},{"id":2,"label":"Normal","color":"cyan"},{"id":3,"label":"High","color":"amber"}]`.
- Actual HTTP 200 on two directory search pages. The first contained Preview Operator / OPERATOR and the second Preview Technician / TECHNICIAN. Both returned valid Core UUIDs and ACTIVE status. The final cursor was null.
- Actual HTTP 401 for anonymous directory access, 403 for Technician and IT Admin, and 403 when Operator called the general IAM user directory. Runtime OpenAPI in the isolated build listed both routes.
- Regression for this change passed 752 Jest cases across 116 suites, 15 Mongo identity cases and the journal scenarios, 9 frontend contract cases, and Edge against mocked Core. The Edge run exercises directory and catalog retry, preview, numeric priority filtering, UUID submission, and Archive/Evidence regression.
- The persistent local Core image still requires the approved secured rollout before its browser can use these endpoints. The rollout procedure is in [secured PoC deployment](../../../deploy/flow04/README.md). Obtain fresh IAM sessions and use a frontend origin already allowed by that deployment. Restarting the old image alone leaves the 404 unchanged.

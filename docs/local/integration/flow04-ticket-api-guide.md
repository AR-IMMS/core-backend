# Flow 04 Ticket API handoff for Web, Mobile and MR

Use the Core base URL for the selected environment and append `/api/v1/tickets`. Send a legitimate Core IAM bearer token. Clients never connect to Zammad or MongoDB. [OpenAPI](../../../api/v1/ticket.yaml) · [PoC Swagger](http://localhost:8082/api/docs) · [Verified backend acceptance](flow04-backend-completion.md#final-backend-acceptance)

| Role | Ticket permissions | Current scope |
| --- | --- | --- |
| OPERATOR | `ticket:read`, `ticket:create`, `ticket:manage`, `ticket:work`, `ticket:close` | Configured Ticket group. Owner-only close still requires the current valid Business Owner. |
| TECHNICIAN | `ticket:read`, `ticket:work` | Current valid Business Owner or Assignee. Work covers only the three non-terminal transitions and internal Articles. A former Assignee may lose access immediately, including access to a same-key replay. |
| IT_ADMIN | IAM's broad catalog | Ticket denies business access on all 13 operations. |

Business Owner and Assignee are separate. An assignment changes only the field sent. Core uses current resource state and IAM permissions on every request. A Technician with an invalid or missing canonical Business Owner cannot read the Ticket even when assigned. The detail DTO does not expose upstream IDs or responsibility identities. Use authorized directory data for responsibility changes and do not infer ownership from a list entry or permission alone. Treat 404 for an existing Ticket as possible loss of access and refresh the list. Avoid UI actions that the known role, capability, state or relationship cannot perform.

### Routes and readiness

Paths below are relative to `/api/v1/tickets`. `:id` is the positive decimal canonical Ticket ID. O/T mean Operator/Technician with current visibility as above. IT_ADMIN is excluded. `D`, `P(D)`, `P(A)`, `A+` and `L` refer to the response schemas below.

| UC | Method and path | Permission and actor | Request and sanitized example | Success and extra errors | Readiness |
| --- | --- | --- | --- | --- | --- |
| 63 | POST `/` | `ticket:create`, O | Required title, description, priority ID, Business Owner and Assignee Core UUIDs. Optional Asset IDs and Incident reference; `reconcile_ticket_id` only for verified recovery. See create command below. | 201 D; 409/503 | READY without Incident |
| 64 | POST `/from-reviewed-draft` | `ticket:create`, O | Required `draft_id`, `revision`, `priority_id`, `business_owner_user_id`, `assignee_user_id`. Example draft `draft-001`, revision `r3`, priority `2` and the two Core UUIDs in the create example. | Intended 201 D; 409; current 503 | BLOCKED by Incident provider |
| 65, 76 | GET `/` | `ticket:read`, O/T | Query only. Example `?assignee_user_id=2c453314-82e9-4e23-a31a-6b88fe52be16&state=OPEN&page_size=10`. Other filters: `business_owner_user_id`, `priority_id`, `search`, `cursor`. | 200 P(D); 503 | READY |
| 66, 76 | GET `/:id` | `ticket:read`, O/T | ID only, no query/body. Example `/16`. | 200 D; 404/503 | READY |
| 67 | PATCH `/:id` | `ticket:manage`, O | At least one of `title` and `priority_id`. Example `{"priority_id":3}`. | 200 D; 404/409/503 | READY |
| 68 | PATCH `/:id/responsibilities` | `ticket:manage`, O | At least one of `business_owner_user_id` and `assignee_user_id` as Core UUIDs. Example `{"assignee_user_id":"2c453314-82e9-4e23-a31a-6b88fe52be16"}`. | 200 D; 404/409/503 | READY |
| 69, 76 | POST `/:id/status` | `ticket:work`, O/T | `{"state":"OPEN"}` or `{"state":"PENDING","pending_until":"2026-11-22T09:30:00+07:00"}`. Set a future deadline when invoking the example. | 200 D; 404/409/503 | READY |
| 70, 76 | POST `/:id/articles` | `ticket:work`, O/T | Required text `body`. Example `{"body":"Checked power and cabling."}`. Core creates an internal note. | 201 A+; 404/409/503 | READY |
| 71, 76 | GET `/:id/articles` | `ticket:read`, O/T | Optional pagination only. Example `/16/articles?page_size=10`. | 200 P(A); 404/503 | READY |
| 72 | PATCH `/:id/links` | `ticket:manage`, O | At least one of `incident_id` or `asset_ids`. Example `{"asset_ids":[]}` clears related Assets. `{"incident_id":null}` clears primary Incident. A supplied Incident reference requires provider validation. | 200 L; 404/409/503 | PARTIAL, Asset links supported |
| 73, 76 | GET `/:id/links` | `ticket:read`, O/T | ID only. Example `/16/links`. | 200 L; 404/503 | PARTIAL, owning providers needed for external references |
| 74 | POST `/:id/close` | `ticket:close`, exact valid current Owner | Required `outcome`. Example `{"outcome":"Sensor replaced and verified."}`. Only OPEN can close. | 200 D; 404/409/503 | READY |
| 75 | POST `/:id/reopen` | `ticket:manage`, authorized Owner or Operator | Required `reason`. Example `{"reason":"Alarm recurred."}`. Only CLOSED can reopen. | 200 D; 404/409/503 | READY |

All routes can return 400 invalid input/reference, 401 missing or invalid session and 403 insufficient permission or role. As listed in OpenAPI, scoped resource lookups can return the same 404 for missing or inaccessible data. Use the shared request ID for support. Static schemas document the complete field shapes.

### Input and response shapes

- IDs and priority IDs are positive safe integers. Core user and Asset IDs use UUIDs. Asset lists contain at most 20 unique references. Optional Incident, draft and revision strings are 1–128 characters using letters, digits, underscores, dots, colons or hyphens. Unknown fields are rejected. Title is 1–200 characters, description and Article body 1–4,000, and outcome/reason 1–500 after trimming.
- List filters allow NEW, OPEN, PENDING or CLOSED. Search is 1–80 letters, digits or spaces. Page size is 1–25, default 20. Use the opaque cursor returned by Core unchanged. Ticket lists are ascending canonical ID, Article lists chronological by ID. Neither returns a total. Use direct detail after a write since Zammad search may lag.
- Progress accepts NEW → OPEN, OPEN → PENDING and PENDING → OPEN. Supply ISO date-time with UTC offset for a future PENDING deadline only. Use dedicated close/reopen routes for terminal changes. In this PoC state IDs are NEW=1, OPEN=2, PENDING=3, CLOSED=4. Clients send string states for progress and should treat IDs as deployment-specific.

Responses share `{"data":…,"meta":{"request_id":"example-request"}}`. Pagination adds `"pagination":{"type":"cursor","next_cursor":null}` at the top level. Each code in the route table uses these sanitized examples:

| Shape | Example `data` |
| --- | --- |
| D, Ticket detail | `{"ticket_id":16,"number":"110016","title":"Inspect rack sensor","state_id":2,"priority_id":2,"created_at":"2026-11-21T08:00:00.000Z","updated_at":"2026-11-21T08:04:00.000Z"}` |
| P(D), paged details | A JSON array of D objects, for example one Ticket detail as above, plus the pagination envelope. |
| P(A), paged Articles | `[{"article_id":42,"type":"note","internal":true,"body_text":"Checked power and cabling.","created_at":"2026-11-21T08:03:00.000Z"}]` plus pagination. Treat text as plain text; unsupported markup has `body_text:null`. |
| A+, append receipt | `{"ticket_id":16,"article_id":42}` |
| L, business links | `{"incident_id":null,"asset_ids":[],"maintenance_activity_ids":[]}`. Incident and Maintenance values are included only when the respective provider validates them. Maintenance attachment is outside PATCH links. |

### Mutation retry and error examples

Generate a distinct operation key for each new POST/PATCH. Keys are 16–128 ASCII letters, digits, underscores or hyphens. Preserve the key and the normalized payload across retries, including after timeout or unavailable response. Receipts are scoped to instance, group and actor. 409 can mean conflicting reuse, a stale lifecycle state or an unresolved external result. Never invent a new key to retry an uncertain creation or append. A verified replay can return a newer authorized detail snapshot. If scope was lost, handle 404 and refresh.

A 503 can represent failed dependency, missing owning provider or a failed readback after a verified write. Known missing providers should be shown as unavailable. When outcome is uncertain, preserve the original key and request ID for support. For a create previously accepted by Zammad, authorized support may retry with the same key and original body plus the positively correlated `reconcile_ticket_id`. A failed search is not proof the original write was absent. [Provider handoff](flow04-owning-module-handoff.md)

Representative Problem Details bodies (host URLs and request IDs are sanitized):

```json
{"type":"about:blank","title":"Not Found","status":404,"detail":"The requested resource was not found.","instance":"/api/v1/tickets/16","code":"NOT_FOUND","request_id":"example-not-found"}
```

```json
{"type":"about:blank","title":"Conflict","status":409,"detail":"Ticket operation outcome is unresolved. Reuse the same request key","instance":"/api/v1/tickets","code":"TICKET_UNRESOLVED","request_id":"example-recovery"}
```

### Executable examples and integration checklist

Run these examples with a prepared disposable profile and valid Core IAM token in the shell. Use different stable keys for create, assignment, progress, Article, close and reopen. The checked-in real runner contains executable three-role examples for all routes and fault recovery is a separate runner. [Runbook and fixture rules](../testing/flow04-ci-runbook.md)

```bash
# Set CORE_URL, CORE_TOKEN, OWNER_UUID, ASSIGNEE_UUID and CREATE_KEY in the test shell.
curl -fsS -X POST "$CORE_URL/api/v1/tickets" \
  -H "Authorization: Bearer $CORE_TOKEN" -H "Idempotency-Key: $CREATE_KEY" \
  -H 'Content-Type: application/json' \
  --data "{\"title\":\"Inspect rack sensor\",\"description\":\"Check cabling\",\"priority_id\":2,\"business_owner_user_id\":\"$OWNER_UUID\",\"assignee_user_id\":\"$ASSIGNEE_UUID\"}"

# With the Technician token, use the returned ID for details.
curl -fsS -H "Authorization: Bearer $CORE_TOKEN" "$CORE_URL/api/v1/tickets/$TICKET_ID"
curl -fsS -H "Authorization: Bearer $CORE_TOKEN" \
  "$CORE_URL/api/v1/tickets?assignee_user_id=$ASSIGNEE_UUID&page_size=10"
```

- Operator creates a manual Ticket, keeps the returned ID, then assigns/reassigns via responsibilities. Keep Owner and Assignee controls independent. For update, close, reopen and links use the row-specific payloads and current Actor scope.
- Technician uses `assignee_user_id` equal to their current Core user for the assigned list. Refresh detail before progress. Offer internal note creation only with `ticket:work` and current scope. Refresh the list on inaccessible detail or replay.
- Keep close and reopen separate from generic progress. After reaffirming identity and current state, submit the respective outcome/reason. Read the same canonical ID after reopen to preserve the history and link view.
- Page Articles and links from Core. Show an unavailable Incident-dependent action until its provider exists. Do not use the absence of links to infer cross-module state.
- On each actual client, execute create → assign → Technician view/progress/Article → Owner close → authorized reopen, then verify loss of access and the recovery UI. Record the device/environment and case IDs. This handoff does not assert physical Web/Mobile/MR acceptance.

## Ticket notifications

`GET /api/v1/ticket-notifications` returns `data.items` and `data.unread_count`. Core takes the 20 most recent completed operations addressed to the caller and rechecks current Ticket access. The count covers the returned inbox. `POST /api/v1/ticket-notifications/read` accepts `{"ids":["<notification UUID>"]}` for one to 20 unique IDs and returns `data.updated_count`. Repeating a read acknowledgement returns zero. An inaccessible item returns 404 before the batch is acknowledged.

Both routes require an active, mapped Operator or Technician with `ticket:read`. Core addresses notifications to the Business Owner and Assignee captured by a verified operation and excludes the initiating actor. The feed omits archived, missing and currently inaccessible Tickets. It returns current Ticket number and title plus event kind, time and read state. Article text and Evidence content remain on their protected APIs.

Core create, responsibility changes, information changes, progress, closure, reopening, internal Articles and Evidence finalization produce notifications when committed. Receipts without recipient snapshots are skipped. Core initializes the partial index `ix_ticket_notification_inbox` on `ticket_operation_receipts` and stores read state per Core user in the receipt. Web and Mobile refresh on open and poll in the foreground. Read state follows the same Core account across clients.

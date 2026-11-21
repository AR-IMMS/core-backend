# IAM owner review for WF-04 ticket:work

Status on 2026-11-21: **approved for the AR-IMMS PoC, applied, deployed and verified over HTTP**. The explicit approval covered the exact patch below. [Current rollout and live evidence](../flow04-backend-completion.md#approved-ticketwork-rollout)

The [exact 12-file patch](flow04-ticket-work-owner-review.patch) was applied after verifying SHA-256 `76059cf961a0dc53ff391d9f33413e42d6316956cb09895d39a9c1affb0e3f3f`.

| Concern | Reviewed behavior |
| --- | --- |
| Shared permission contract | Add `ticket:work` to the IAM  , capability description and IAM OpenAPI enum. Add it to Operator and Technician role baselines. The existing all-catalog IAM admin baseline inherits it, while Ticket still rejects IT_ADMIN before resource access. The same IAM YAML file also drops a pre-existing duplicate empty `security` key on browser refresh and retains the documented cookie requirement. No per-user grant or shared submodule update is needed. |
| Compatibility | Operator keeps read/create/manage/close and gains work in the same change as the two guard changes. The same status and Article routes, payloads, responses, receipt actions and idempotency keys are preserved. IAM reads the active session/user and recalculates permissions from the role baseline, so the change requires no permission data migration or credential reset. Consumers that treat the catalog enum as closed should update their generated IAM types before rollout. |
| Enforcement | HTTP and workflow checks use `ticket:work` for non-terminal progress and internal Article append. Current `ticket:read`, active mapping, valid Owner/Assignee scope and upstream eligibility remain mandatory. Receipt replay still requires current resource access. Responsibilities, information and links keep management checks. Closure and reopen keep their separate permission and ownership policies. |
| Candidate evidence | 728 tests across 115 suites passed, including 372 IAM/Ticket tests. TypeScript, lint, build, both OpenAPI specs, 14 Mongo mapping tests and Mongo journal integration passed. Added cases cover missing/revoked/wrong-group mapping, Owner protections for work-only Technicians, protected links and guard/Swagger metadata. The HTTP runner exercises same-key replay after loss of responsibility once the reviewed candidate is deployed. |

### Rollout and verification checklist

Before rollout, the selected Zammad proxy published `127.0.0.1:8081` on its default network and Core could not resolve `zammad-nginx`. The approved rollout restored the private attachment and closed the published port. The unrelated 8080 stack is outside scope. Ticket 11 still has a locked `dispatching` receipt without a verified result in Mongo; exclude it from every write test. [Secured deployment runbook](../../../../deploy/flow04/README.md)

After approval, check the digest and apply the reviewed patch together across IAM and Ticket. Build and start the selected secured PoC using `deploy/flow04/manage.ps1 -Action Start -Build`. Verify the private backend networks and absent Zammad/Mongo host publications, then verify current `/api/v1/auth/me` and IAM/Swagger metadata with fresh legitimate sessions in the ignored session file. Do not reuse expired sessions or reset credentials.

Use the dedicated disposable workflow with `FLOW04_REAL_TICKET_FIXTURE_ID=13`, `FLOW04_DISPOSABLE_HTTP_WORKFLOW=true` and `FLOW04_EXPECT_TECH_WORK=true`:

- Technician starts, pauses and resumes assigned work and appends one internal note. The same key returns the same Article ID. The Article Audit actor is Technician.
- An unrelated Technician and a former assignee without ownership get 404 for status and Article writes, including replay of the previously successful key. The Technician gets 403 when attempting assignment, Owner change, information/link management, closure or reopen. Use a fresh disposable Ticket.
- Operator retains management and Owner-only closure, including a denied non-owner closure. IT_ADMIN remains denied every Ticket operation. Read back canonical state, ownership, notes and Audit.
- Re-run the full coverage suite, IAM/Ticket regression, Mongo mapping/journal and OpenAPI validation from the deployed commit. Record actual results separately from isolated candidate tests and historical HTTP evidence.

Incident/Maintenance provider approval and physical Web/Mobile/MR acceptance remain separate. [Provider handoff](../flow04-owning-module-handoff.md) · [API guide](../flow04-ticket-api-guide.md)

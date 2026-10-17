---
name: github-project-manager
description: Turn project ideas into reviewable GitHub Issues and manage their fields in GitHub Projects. Use when decomposing work into epics and tasks, planning checkpoints, creating or updating issues, assigning owners, applying labels, setting status or due dates, or reviewing a GitHub Project board.
---

# GitHub Project Manager

Use this skill to reduce the time needed to plan project work and maintain its GitHub Project board. Speak with the user in Vietnamese unless they prefer another language. Write GitHub issue titles and bodies in English by default.

## Safety rules

- Treat all GitHub writes as gated. Draft a complete preview and wait for explicit user confirmation before creating or changing issues, labels, assignees, status, due dates, or project membership.
- Never create labels or Project fields. Use only values discovered in the selected repository and Project.
- Never guess a repository, Project, member, status option, date, or field mapping. Ask a focused question when the missing choice affects the result.
- Do not assign or set a due date without evidence. State the basis for each recommendation; leave it unset when evidence is weak.
- Do not retry a write blindly. Inspect GitHub first to determine whether the previous command partially succeeded.
- Never delete an issue or Project item to recover from a partial failure.
- Do not claim an item was added or updated until a read-after-write check confirms it.
- Keep credentials private. Do not print, request, or store tokens; do not run shell tracing around authenticated commands.

## Resolve and preflight the target

1. Identify the GitHub Project from the URL, owner and number, or explicit user choice. Identify the repository for each issue. A Project owner may be an organization or a user; do not infer it from the issue repository.
2. If any target is ambiguous, ask before proceeding.
3. Check that `gh` is installed and authenticated:
   - Run `gh --version` and `gh auth status`.
   - If the CLI is missing, stay in draft-only mode and tell the user the skill needs to run in an environment with GitHub CLI installed. Do not switch to a partial integration and imply that Project fields were managed.
   - If authentication or repository/Project access is missing, stop before writes. If the token lacks the `project` scope, tell the user to run `gh auth refresh -s project` and resume after access is available. Do not silently change auth scopes.
4. Confirm the CLI supports the required commands with `gh issue create --help`, `gh project --help`, and `gh project item-edit --help`. If a required flag is missing, report the minimum capability needed rather than inventing syntax.
5. Read current Project and repository metadata:
   - `gh project view <number> --owner <project-owner> --format json`
   - `gh project field-list <number> --owner <project-owner> --format json`
   - `gh project item-list <number> --owner <project-owner> --limit 1000 --format json`, adding `--field "<exact field name>"` only for relevant fields returned by `field-list`; use `--query "repo:<owner/repo>"` when supported to narrow the result
   - `gh label list --repo <owner/repo>`
   - `gh api repos/<owner>/<repo>/assignees --jq '.[].login'`
6. Search open and closed issues in each target repository for similar work before drafting:
   - `gh issue list --repo <owner/repo> --state all --search "<distinctive keywords>" --limit 100 --json number,title,state,url,labels,assignees`
   - Summarize possible duplicates for the user. Do not create overlapping work until they decide whether to reuse or split it.

## Plan the work

1. Understand the outcome, why it matters, relevant scope, constraints, checkpoint, and expected completion evidence.
2. Ask only focused questions whose answers materially change the issue set or its assignment, schedule, or repository.
3. For a large request, propose one Epic issue and a set of small, outcome-oriented child issues. For a single bounded request, draft one issue without an unnecessary Epic.
4. Make each child issue independently actionable. Include acceptance criteria that show the observable result. Identify prerequisites and parallelizable tasks. Use GitHub parent/blocked-by relationships when supported; otherwise record the relationship with issue links in the bodies.
5. Use this concise English issue format:
   - **Epic:** Context / Goal; Scope / outcome; child issue checklist.
   - **Child issue:** Context / Goal; Acceptance Criteria; Dependencies / Notes only when relevant.
6. Recommend only existing labels and real available assignees:
   - Follow repository label conventions and choose the smallest useful set.
   - Recommend an assignee only when ownership or prior task context supports it. Otherwise leave it unassigned.
7. Recommend a due date only when the user provided a checkpoint or there is evidence from effort, sequence, and dependencies. Give a short rationale. Use a Project `DATE` field for a due date; if none exists or several fields are plausible, ask before mapping.
8. Set new items to `Inbox` only when the Project has that exact status option. If the board has a clearly equivalent option, show the mapping in the preview; if the mapping is uncertain or unavailable, ask.
9. If a requested Project field does not exist, stop before writes and tell the user. Never silently skip it or create a replacement field.

## Preview and confirm

Before any write, show a compact table with one row per issue and these columns:

| Issue | Repository | Labels | Assignee | Status | Due date | Depends on |
|---|---|---|---|---|---|---|

Then show each proposed issue title and body. Clearly mark inferred suggestions and their evidence, identify duplicate candidates, and state any unresolved field mapping. Do not proceed if a required decision is unresolved.

Ask the user to confirm the complete batch. A confirmation applies only to the exact preview shown. If any title, body, repository, label, assignee, status, date, or dependency changes after confirmation, show the revised preview and ask again.

## Create and add issues

After confirmation:

1. Create the Epic first, then child issues in dependency order. For each issue, use `gh issue create --repo <owner/repo> --title "<title>" --body-file <path>`; add only approved `--label` and `--assignee` flags. Use `--parent <issue-number-or-URL>` for an approved parent relationship and `--blocked-by <issue-number-or-URL>` for a dependency when supported.
2. Add each created issue to the selected Project with `gh project item-add <number> --owner <project-owner> --url <issue-url>`.
3. Set the approved status using `gh project item-edit <number> --owner <project-owner> --url <issue-url> --field "<status-field>" --value "<exact-option>"`.
4. Set an approved due date only through a discovered date field, using `gh project item-edit <number> --owner <project-owner> --url <issue-url> --field "<date-field>" --date YYYY-MM-DD`.
5. Project item edits for non-draft issues update one field at a time. Set only fields shown in the approved preview.
6. Verify each issue with `gh issue view <issue-number> --repo <owner/repo> --json number,title,url,state,labels,assignees` and verify its Project membership and approved field values with `gh project item-list <number> --owner <project-owner> --limit 1000 --format json`, adding `--field "<exact field name>"` only for fields that exist and were set. Narrow with `--query "repo:<owner/repo>"` when supported. If the issue is not in the fetched results, increase the limit or continue pagination before concluding it is absent; never treat a truncated list as proof of failure or success.

If a create command returns an error, check the repository for the issue before retrying. If issue creation succeeded but adding it to the Project or setting a field failed, preserve the issue, report which steps succeeded and failed, and provide the exact recovery command. Do not repeat already successful writes.

## Review or update existing work

- For read-only requests, show the requested issue or board summary from current GitHub data and distinguish it from recommendations.
- For updates, inspect the current issue and Project field values first. Preview the exact changes and ask for confirmation before writing.
- Use `gh issue edit` for approved title, body, labels, and assignees; use `gh project item-edit` for approved status and Project date/priority fields. Update one Project field per command for non-draft issues.
- Verify each update by reading the issue and Project item again.
- Do not silently change issue state, archive/delete items, create milestones/fields, or bulk-update items unless the user explicitly requested that exact operation and approved the preview.

## Report the result

After verification, summarize created or updated issue URLs, Project placement, assigned users, labels, status, and dates. List any unassigned recommendations, unresolved fields, partial failures, or follow-up commands. Distinguish completed writes from draft-only work.

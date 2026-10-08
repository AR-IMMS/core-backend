---
name: publish-tickets
display_name: Publish Tickets
description: Use when the user explicitly asks to publish an approved local ticket draft to GitHub using the repository's issue tracker configuration.
disable-model-invocation: true
---

# Publish Tickets

Publish an approved local ticket draft to GitHub using `gh`.

## Required inputs

- Path to a ticket bundle marked `Review status: approved`.
- `.agents/issue-tracker.yml` with a valid target.

If either input is missing or ambiguous, explain what is missing and stop before creating issues.

## Process

### 1. Load and validate

Read the complete ticket bundle and `.agents/issue-tracker.yml`.

Resolve the target in this order:

1. Target explicitly named by the user.
2. Target recorded in the approved draft.
3. Target matching the current repository's Git remote.
4. `default_target`, if no conflicting context exists.

Ask the user if the target is ambiguous or conflicts with the repository context.

Validate that:

- Every ticket has a title, description, acceptance criteria, and stable ticket ID.
- Every blocker refers to a ticket in the bundle or an existing issue.
- The dependency graph has no cycles.
- Each ticket has reviewed label suggestions.
- Labels exist in the target repository.
- Project owner, number, status field, and initial status are valid.
- No ticket is already published, except when resuming a partial publish.

Do not create labels automatically. If label suggestions are missing or a configured label no longer exists, update the local draft and stop for review.

### 2. Check GitHub CLI access

Use `gh` for all GitHub writes.

Check that `gh` is installed and authenticated for the configured repository. Verify repository access, labels, and project configuration before creating any issues.

GitHub Projects requires the `project` authorization scope. If access is missing, stop and tell the user to run:

`gh auth refresh -s project`

Do not start publishing if the target or required permissions cannot be verified.

### 3. Publish in dependency order

Create tickets only after their blockers have issue URLs or numbers.

For each ticket:

1. Create a temporary Markdown body file containing the ticket description, acceptance criteria, blocker references, and a stable draft/ticket marker.
2. Create the issue non-interactively:

   `gh issue create --repo <owner/repo> --title <title> --body-file <body-file> --label <label>`

   Add `--blocked-by <issue-number-or-url>` when the blocker has already been published. Add `--parent <issue-number-or-url>` only when the approved draft identifies a parent issue.

3. Add the issue to the configured project:

   `gh project item-add <project-number> --owner <project-owner> --url <issue-url>`

4. Set the configured initial status:

   `gh project item-edit <project-number> --owner <project-owner> --url <issue-url> --field <status-field> --value <initial-status>`

5. Record the created issue URL and number in the local draft before continuing.

Use only labels listed in the reviewed draft. Never infer or add new labels during publication.

Do not close or modify a parent issue.

### 4. Handle partial failure

Publish one ticket at a time and record each successful issue immediately.

If a command fails, inspect its result and verify whether GitHub created the issue before retrying. Preserve successful issue references. On a later run, skip tickets that already have a recorded issue URL and publish only the remaining tickets.

Do not create a duplicate issue to recover from a partial failure.

### 5. Report completion

List each published ticket with its issue URL, labels, Project placement, status, and blocker links. Report any ticket left unpublished and the reason.

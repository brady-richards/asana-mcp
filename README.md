# asana-mcp

Asana MCP server for Claude Code — tasks, projects, sections, tags, stories, custom fields, attachments, users/teams, events, and typeahead via PAT tokens.

A stdio MCP server on the official `asana` Node SDK. One process per workspace: `asana-mcp --slug <slug>` reads its PAT from `ASANA_PAT_<SLUG>` (e.g. `--slug work` → `ASANA_PAT_WORK`).

## Tool families

- **Tasks** — create/update/delete, subtasks, dependencies/dependents, followers, project & section membership, tags, parenting, `asana_get_my_tasks`, `asana_get_multiple_tasks_by_gid` (Batch-API-backed, up to 25).
- **Task search** — `asana_search_tasks` with advanced filters: text, assignee (`assignee_any`/`assignee_not`), due/start/modified date bounds, creation-time bounds (`created_at_after`/`created_at_before`, full ISO-8601 timestamps), projects/sections/tags, blocked/blocking/subtask/attachment state, `resource_subtype`, and a `custom_fields` passthrough (`{"<gid>.<query>": value}`).
- **Bulk update** — `asana_batch_update_tasks`: up to 50 per-task updates (complete, reassign, dates, section moves) in chunked Batch API calls, returning compact per-action success/error results (pass `opt_fields` for task bodies).
- **Duplicate** — `asana_duplicate_task`: async-job-backed duplication (the recurrence primitive); polls up to ~30s, then reports the job gid as still running instead of failing.
- **Projects** — search/get/create/update, task counts, and status updates (`asana_create_project_status` et al., backed by the StatusUpdates API with `status_type` support).
- **Sections** — list/create/rename/delete, plus `asana_insert_section` to reorder a section before/after another.
- **Tags** — workspace tags CRUD and task tagging.
- **Stories** — read a task's comment/activity stream, post comments (HTML or plain).
- **Custom fields** — workspace field definitions CRUD, enum option management, attach fields to projects; set values via task create/update.
- **Attachments** — list a task's attachments, fetch one (incl. short-lived `download_url`), and upload via external URL or local file (multipart).
- **Users & teams** — workspace/team member listings, `asana_get_user` (gid, `me`, or email), teams per workspace.
- **Events** — `asana_get_events`: sync-token change feed for a task/project (change-detection primitive; handles Asana's 412 token handshake transparently).
- **Typeahead** — resolve partial names/emails to GIDs across object types.
- **Workspaces** — `asana_list_workspaces`.

## Free vs. paid workspaces

Some endpoints are gated to premium Asana workspaces and return `402 Payment Required` on free-tier ones — notably task search (`asana_search_tasks`), custom fields, and start dates. The server maps 402s to a clear "premium feature" error message and, for search, suggests `asana_get_tasks_for_project` as the free-tier fallback.

## Development

```sh
npm install
npm run build   # tsc → dist/
npm test        # vitest
```

// Asana's task-search endpoint (`GET /workspaces/{gid}/tasks/search`) expects several
// filter parameters in dot notation (e.g. `assignee.any`), not underscore notation
// (`assignee_any`). Our tool schema keeps the underscore names (MCP tool params can't
// contain dots as easily and we don't want to break existing callers), so this map
// renames them just before the SDK call.
//
// Verified against node_modules/asana/src/api/TasksApi.d.ts searchTasksForWorkspace
// opts (opts.assignee.any, opts['assignee.not'], opts.due_on.before, opts.due_on.after,
// opts.modified_on.after, opts.projects.any, opts.sections.any, opts.tags.any,
// opts['start_on.before'], opts['start_on.after']). `is_blocked`, `is_blocking`,
// `is_subtask`, `has_attachment`, and `resource_subtype` are already the literal
// Asana parameter names, so they need no rename — they pass through unchanged.
//
// `created_at.before` / `created_at.after` are absent from that generated opts list, but the
// endpoint does accept them (verified against the live API 2026-09-18, both as a pair and
// with `.after` as the only filter). The SDK spreads unrecognized opts through verbatim as
// query params — see node_modules/asana/src/api/TasksApi.js — so this rename is the whole
// passthrough. Unlike every other date filter here, the two take a full ISO-8601 timestamp,
// not YYYY-MM-DD.
const SEARCH_FILTER_RENAME_MAP: Record<string, string> = {
  assignee_any: "assignee.any",
  assignee_not: "assignee.not",
  due_on_before: "due_on.before",
  due_on_after: "due_on.after",
  modified_on_after: "modified_on.after",
  projects_any: "projects.any",
  sections_any: "sections.any",
  tags_any: "tags.any",
  start_on_before: "start_on.before",
  start_on_after: "start_on.after",
  created_at_before: "created_at.before",
  created_at_after: "created_at.after",
};

/**
 * Flattens a `custom_fields` passthrough object (`{"<gid>.<query>": value}`,
 * e.g. `{"12345.value": "67890", "12345.is_set": true}` — see the custom field
 * parameter table in TasksApi.d.ts's searchTasksForWorkspace doc comment) into
 * top-level `custom_fields.<gid>.<query>` keys, which is the literal query
 * parameter shape the search endpoint (and the SDK's own passthrough handling
 * in TasksApi.js, which special-cases keys matching the pattern
 * "custom_fields.<gid>.<anything>") expects. Entries whose value is
 * `undefined` are dropped.
 */
function flattenCustomFields(customFields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [suffix, value] of Object.entries(customFields)) {
    if (value === undefined) continue;
    result[`custom_fields.${suffix}`] = value;
  }
  return result;
}

/**
 * Renames underscore-notation search filter keys to the dot notation Asana's
 * search endpoint requires, and flattens the `custom_fields` passthrough object
 * (see `flattenCustomFields`). Keys with no mapping entry pass through
 * unchanged. Keys whose value is `undefined` are dropped.
 */
export function mapSearchFilterParams(
  params: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (key === "custom_fields") {
      Object.assign(result, flattenCustomFields(value as Record<string, unknown>));
      continue;
    }
    const mappedKey = SEARCH_FILTER_RENAME_MAP[key] ?? key;
    result[mappedKey] = value;
  }
  return result;
}

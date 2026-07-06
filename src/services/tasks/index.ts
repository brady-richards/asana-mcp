import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling, extractAsanaError } from "../../utils/errors.js";
import { parseOptFields } from "../../utils/optFields.js";
import { limitParam, offsetParam, paginationOpts, pagedResult } from "../../utils/pagination.js";
import { mapSearchFilterParams } from "./searchFilterMap.js";
import {
  dateField,
  datetimeField,
  nullableDateField,
  nullableDatetimeField,
  assertMutuallyExclusive,
  assertExactlyOneOf,
  normalizeAndValidateDateFields,
} from "./validation.js";
import {
  chunk,
  MAX_BATCH_ACTIONS,
  isBatchActionSuccess,
  batchActionErrorMessage,
  buildGetTaskAction,
  buildTaskUpdateActions,
  executeBatchUpdate,
  BatchActionResult,
  TaskBatchUpdateInput,
} from "./batch.js";
import { startAndPollJob, JobLike } from "./jobs.js";

// The generated .d.ts for searchTasksForWorkspace omits `limit` even though Asana's
// docs ("Page sizes are limited to a maximum of 100 items, and can be specified by
// the limit query parameter") and the JS implementation (queryParams = opts, spread
// through verbatim — see node_modules/asana/src/api/TasksApi.js) both support it.
type SearchTasksOpts = NonNullable<
  Parameters<InstanceType<typeof Asana.TasksApi>["searchTasksForWorkspace"]>[1]
>;

export function registerTasksTools(
  server: McpServer,
  ctx: ServiceContext
): void {
  const tasks = () => new Asana.TasksApi(ctx.apiClient);
  const sections = () => new Asana.SectionsApi(ctx.apiClient);
  const batchApi = () => new Asana.BatchAPIApi(ctx.apiClient);
  const jobsApi = () => new Asana.JobsApi(ctx.apiClient);

  server.tool(
    "asana_search_tasks",
    "Search tasks with advanced filters",
    {
      workspace: z.string().describe("Workspace GID"),
      text: z.string().optional().describe("Full-text search query"),
      assignee_any: z.string().optional().describe("Comma-separated user GIDs or 'me'"),
      assignee_not: z.string().optional().describe("Comma-separated user GIDs or 'me' to exclude"),
      due_on_before: z.string().optional().describe("Due date upper bound (YYYY-MM-DD)"),
      due_on_after: z.string().optional().describe("Due date lower bound (YYYY-MM-DD)"),
      due_on: z.string().optional().describe("Exact due date (YYYY-MM-DD)"),
      start_on_before: z.string().optional().describe("Start date upper bound (YYYY-MM-DD)"),
      start_on_after: z.string().optional().describe("Start date lower bound (YYYY-MM-DD)"),
      completed: z.boolean().optional().describe("Filter by completion status"),
      completed_on: z.string().optional().describe("Completed on date (YYYY-MM-DD)"),
      modified_on_after: z.string().optional().describe("Modified after (YYYY-MM-DD)"),
      projects_any: z.string().optional().describe("Comma-separated project GIDs"),
      sections_any: z.string().optional().describe("Comma-separated section GIDs"),
      tags_any: z.string().optional().describe("Comma-separated tag GIDs"),
      is_blocked: z.boolean().optional().describe("Filter to tasks with incomplete dependencies"),
      is_blocking: z.boolean().optional().describe("Filter to incomplete tasks with dependents"),
      is_subtask: z.boolean().optional().describe("Filter to subtasks"),
      has_attachment: z.boolean().optional().describe("Filter to tasks with attachments"),
      resource_subtype: z
        .enum(["default_task", "milestone", "approval"])
        .optional()
        .describe("Filter by the task's resource_subtype"),
      custom_fields: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'Custom field filter passthrough — keys are "<gid>.<query>" (e.g. "<gid>.value", "<gid>.is_set", "<gid>.starts_with", "<gid>.ends_with", "<gid>.contains", "<gid>.less_than", "<gid>.greater_than", per field type), e.g. {"12345.value": "67890", "999.is_set": true}. See Asana\'s task search docs for the full custom field parameter table.'
        ),
      sort_by: z.enum(["due_date", "created_at", "completed_at", "modified_at"]).optional().describe("Sort field"),
      sort_ascending: z.boolean().optional().describe("Sort direction"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "Max results (1-100). Asana caps search results at 100 server-side and does not support traditional offset pagination for this endpoint — re-run with a narrower filter (e.g. modified_on_after) to see more."
        ),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async (params) => {
      const { workspace, opt_fields, limit, ...filterParams } = params;
      const searchQuery: SearchTasksOpts & { limit?: number } = {
        ...mapSearchFilterParams(filterParams),
        opt_fields: parseOptFields(
          opt_fields,
          "name,due_on,completed,assignee.name,projects.name,permalink_url,resource_subtype,num_subtasks,parent.name"
        ),
      };
      if (limit !== undefined) searchQuery.limit = limit;
      const res = await tasks().searchTasksForWorkspace(workspace, searchQuery);
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_get_task",
    "Get full details of a task",
    {
      task_id: z.string().describe("Task GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ task_id, opt_fields }) => {
      const res = await tasks().getTask(task_id, {
        opt_fields: parseOptFields(
          opt_fields,
          "name,notes,due_on,due_at,completed,assignee.name,projects.name,tags.name,custom_fields.name,custom_fields.display_value,permalink_url,parent.name,num_subtasks"
        ),
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_get_multiple_tasks_by_gid",
    "Get details for up to 25 tasks by GID",
    {
      task_ids: z.array(z.string()).max(25).describe("Array of task GIDs (max 25)"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ task_ids, opt_fields }) => {
      const fields = parseOptFields(
        opt_fields,
        "name,due_on,completed,assignee.name,projects.name,permalink_url,resource_subtype,num_subtasks,parent.name"
      );
      // Chunked via the Batch API (POST /batch, max 10 actions/request) instead of up
      // to 25 unbounded parallel GETs — see src/services/tasks/batch.ts.
      const idChunks = chunk(task_ids, MAX_BATCH_ACTIONS);
      const chunkResults = await Promise.all(
        idChunks.map(async (ids) => {
          const actions = ids.map((id) => buildGetTaskAction(id, fields));
          const res = await batchApi().createBatchRequest({ data: { actions } });
          const results = (res.data ?? []) as BatchActionResult[];
          if (results.length !== actions.length) {
            // Results are attributed to GIDs positionally — a count mismatch
            // must fail loudly rather than silently mislabel tasks.
            throw new Error(
              `Asana /batch returned ${results.length} result(s) for ${actions.length} submitted action(s) — cannot attribute results to task GIDs.`
            );
          }
          return results;
        })
      );
      const results = chunkResults.flat();

      const failures = results
        .map((result, i) => ({ id: task_ids[i], result }))
        .filter(({ result }) => !isBatchActionSuccess(result));
      if (failures.length > 0) {
        const message = failures
          .map(({ id, result }) => `${id}: ${batchActionErrorMessage(result.body)}`)
          .join("; ");
        throw new Error(`Failed to fetch ${failures.length} of ${task_ids.length} task(s): ${message}`);
      }

      return textResult(results.map((result) => (result.body as { data: unknown }).data));
    })
  );

  server.tool(
    "asana_batch_update_tasks",
    "Bulk-update up to 50 tasks in one round trip (complete, reassign, change dates, move between sections) via Asana's Batch API. Each update becomes one or two batch actions (a field PUT and/or a section-move POST), chunked into requests of up to 10 actions. Returns per-action success/error results in the same order as `updates`. If one chunk's request fails outright (e.g. rate limit), its tasks are reported with chunk_request_failed (status unknown — verify before retrying) while other chunks' results are preserved.",
    {
      updates: z
        .array(
          z.object({
            task_id: z.string().describe("Task GID to update"),
            name: z.string().optional().describe("New task name"),
            notes: z.string().optional().describe("New description"),
            html_notes: z.string().optional().describe("New HTML description"),
            completed: z.boolean().optional().describe("Mark as completed or not"),
            assignee: z.string().optional().describe("New assignee GID or 'me'"),
            due_on: nullableDateField().describe(
              'New due date (YYYY-MM-DD). Pass null (or "null") to clear it. Mutually exclusive with due_at.'
            ),
            due_at: nullableDatetimeField().describe(
              'New due date and time, ISO 8601 UTC. Pass null (or "null") to clear it. Mutually exclusive with due_on.'
            ),
            start_on: nullableDateField().describe(
              'New start date (YYYY-MM-DD). Pass null (or "null") to clear it. Mutually exclusive with start_at.'
            ),
            start_at: nullableDatetimeField().describe(
              'New start date and time, ISO 8601 UTC. Pass null (or "null") to clear it. Mutually exclusive with start_on.'
            ),
            section_id: z
              .string()
              .optional()
              .describe(
                "Move the task into this section (GID) — a separate batch action from any field updates above."
              ),
            insert_before: z.string().optional().describe("When moving into a section, task GID to insert before"),
            insert_after: z.string().optional().describe("When moving into a section, task GID to insert after"),
          })
        )
        .min(1)
        .max(50)
        .describe(
          "Per-task updates; each becomes 0-2 batch actions (a field PUT and/or a section-move POST)."
        ),
    },
    withErrorHandling(async ({ updates }) => {
      // All validation happens here, before any batch request is submitted.
      // Dates are normalized ("null" → null) BEFORE the exclusivity check so
      // clearing one sibling while setting the other (date↔datetime switch)
      // is accepted — see normalizeAndValidateDateFields.
      const groups = updates.map((update) => {
        const { task_id, section_id, insert_before, insert_after, due_on, due_at, start_on, start_at, ...rest } =
          update;
        const dates = normalizeAndValidateDateFields({ due_on, due_at, start_on, start_at });
        const normalized: TaskBatchUpdateInput = {
          task_id,
          section_id,
          insert_before,
          insert_after,
          ...rest,
          ...dates,
        };
        return { task_id, plans: buildTaskUpdateActions(normalized) };
      });

      // Chunk failures are isolated per chunk (not thrown): each affected
      // task is reported with chunk_request_failed instead, so one rate-limited
      // or 5xx'd /batch call can't discard the results of mutations that other
      // chunks already applied — see executeBatchUpdate.
      const results = await executeBatchUpdate(groups, async (actions) => {
        try {
          const res = await batchApi().createBatchRequest({ data: { actions } });
          return (res.data ?? []) as BatchActionResult[];
        } catch (e) {
          throw new Error(extractAsanaError(e).message);
        }
      });

      return textResult({ results });
    })
  );

  server.tool(
    "asana_get_my_tasks",
    "Get tasks assigned to the authenticated user",
    {
      workspace: z.string().describe("Workspace GID"),
      completed_since: z.string().optional().describe("Only incomplete tasks or tasks completed since this date ('now' for incomplete only)"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ workspace, completed_since, limit, offset, opt_fields }) => {
      const res = await tasks().getTasks({
        workspace,
        assignee: "me",
        completed_since: completed_since || "now",
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(
          opt_fields,
          "name,due_on,due_at,completed,projects.name,permalink_url,resource_subtype,num_subtasks,parent.name"
        ),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_get_tasks_for_project",
    "Get tasks in a project",
    {
      project_id: z.string().describe("Project GID"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ project_id, limit, offset, opt_fields }) => {
      const res = await tasks().getTasksForProject(project_id, {
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(
          opt_fields,
          "name,due_on,completed,assignee.name,permalink_url,resource_subtype,num_subtasks,parent.name,memberships.section.name"
        ),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_get_tasks_for_tag",
    "Get tasks with a specific tag",
    {
      tag_id: z.string().describe("Tag GID"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ tag_id, limit, offset, opt_fields }) => {
      const res = await tasks().getTasksForTag(tag_id, {
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(
          opt_fields,
          "name,due_on,completed,assignee.name,permalink_url,resource_subtype,num_subtasks,parent.name"
        ),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_create_task",
    "Create a new task",
    {
      project_id: z
        .string()
        .optional()
        .describe("Project GID to create the task in. Provide exactly one of project_id or workspace."),
      workspace: z
        .string()
        .optional()
        .describe(
          "Workspace GID for an untargeted task — lands in the creator's My Tasks list (useful for quick GTD-style capture before triaging into a project). Provide exactly one of project_id or workspace."
        ),
      name: z.string().describe("Task name"),
      notes: z.string().optional().describe("Task description"),
      html_notes: z.string().optional().describe("HTML-formatted task description"),
      due_on: dateField().optional().describe("Due date (YYYY-MM-DD). Mutually exclusive with due_at."),
      due_at: datetimeField()
        .optional()
        .describe("Due date and time, ISO 8601 UTC (e.g. 2026-01-15T09:00:00Z). Mutually exclusive with due_on."),
      start_on: dateField().optional().describe("Start date (YYYY-MM-DD). Mutually exclusive with start_at."),
      start_at: datetimeField()
        .optional()
        .describe("Start date and time, ISO 8601 UTC. Mutually exclusive with start_on."),
      assignee: z.string().optional().describe("Assignee GID or 'me'"),
      parent: z.string().optional().describe("Parent task GID"),
      projects: z.array(z.string()).optional().describe("Additional project GIDs"),
      custom_fields: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Custom field GID→value map. Setting this at create time avoids a separate create-then-update round trip."
        ),
      resource_subtype: z
        .enum(["default_task", "milestone", "approval"])
        .optional()
        .describe(
          "Task subtype. 'default_task' is the standard unit of work; 'milestone' renders with a diamond icon and is the right call for project-level outcomes; 'approval' renders approve/reject actions instead of a checkbox — pair with asana_update_task's approval_status to record the decision. Mutable via asana_update_task."
        ),
    },
    withErrorHandling(async ({ project_id, workspace, projects: extraProjects, ...taskData }) => {
      assertExactlyOneOf({ project_id, workspace }, ["project_id", "workspace"]);
      assertMutuallyExclusive(taskData, [
        ["due_on", "due_at"],
        ["start_on", "start_at"],
      ]);

      const body: Record<string, unknown> = { ...taskData };
      if (project_id !== undefined) {
        body.projects = [project_id, ...(extraProjects || [])];
      } else {
        body.workspace = workspace;
        if (extraProjects && extraProjects.length > 0) body.projects = extraProjects;
      }

      const res = await tasks().createTask({ data: body });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_update_task",
    "Update an existing task",
    {
      task_id: z.string().describe("Task GID to update"),
      name: z.string().optional().describe("New task name"),
      notes: z.string().optional().describe("New description"),
      html_notes: z.string().optional().describe("New HTML description"),
      due_on: nullableDateField().describe(
        'New due date (YYYY-MM-DD). Pass null (or the string "null") to clear it. Mutually exclusive with due_at.'
      ),
      due_at: nullableDatetimeField().describe(
        'New due date and time, ISO 8601 UTC. Pass null (or "null") to clear it. Mutually exclusive with due_on.'
      ),
      start_on: nullableDateField().describe(
        'New start date (YYYY-MM-DD). Pass null (or "null") to clear it. Mutually exclusive with start_at.'
      ),
      start_at: nullableDatetimeField().describe(
        'New start date and time, ISO 8601 UTC. Pass null (or "null") to clear it. Mutually exclusive with start_on.'
      ),
      assignee: z.string().optional().describe("New assignee GID or 'me'"),
      completed: z.boolean().optional().describe("Mark as completed or not"),
      approval_status: z
        .enum(["pending", "approved", "rejected", "changes_requested"])
        .optional()
        .describe(
          "Approval decision, for tasks with resource_subtype 'approval'. Kept in sync with completed — approved/rejected/changes_requested all mark it complete."
        ),
      custom_fields: z.record(z.string(), z.unknown()).optional().describe("Custom field GID→value map"),
      resource_subtype: z
        .enum(["default_task", "milestone", "approval"])
        .optional()
        .describe(
          "Convert between task subtypes. Pass 'milestone' to mark a row as a milestone (diamond icon, used for project-level outcomes); 'approval' for an approve/reject task; 'default_task' converts back to a standard task. Mutation preserves gid, custom fields, subtasks, stories, and project membership."
        ),
    },
    withErrorHandling(async ({ task_id, due_on, due_at, start_on, start_at, ...rest }) => {
      // Normalizes "null" → null BEFORE the mutual-exclusivity check, so
      // clearing one sibling while setting the other (e.g. due_on: "null" +
      // due_at: <datetime>, a date→datetime switch) is accepted.
      const dates = normalizeAndValidateDateFields({ due_on, due_at, start_on, start_at });
      const res = await tasks().updateTask({ data: { ...rest, ...dates } }, task_id);
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_delete_task",
    "Delete a task permanently",
    {
      task_id: z.string().describe("Task GID to delete"),
    },
    withErrorHandling(async ({ task_id }) => {
      await tasks().deleteTask(task_id);
      return textResult({ ok: true, deleted: task_id });
    })
  );

  server.tool(
    "asana_create_subtask",
    "Create a subtask under a parent task",
    {
      parent_task_id: z.string().describe("Parent task GID"),
      name: z.string().describe("Subtask name"),
      notes: z.string().optional().describe("Subtask description"),
      html_notes: z.string().optional().describe("HTML-formatted subtask description"),
      due_on: dateField().optional().describe("Due date (YYYY-MM-DD). Mutually exclusive with due_at."),
      due_at: datetimeField()
        .optional()
        .describe("Due date and time, ISO 8601 UTC. Mutually exclusive with due_on."),
      assignee: z.string().optional().describe("Assignee GID or 'me'"),
      resource_subtype: z
        .enum(["default_task", "milestone", "approval"])
        .optional()
        .describe("Subtask subtype — see asana_create_task for details. Mutable via asana_update_task."),
    },
    withErrorHandling(async ({ parent_task_id, ...taskData }) => {
      assertMutuallyExclusive(taskData, [["due_on", "due_at"]]);
      const res = await tasks().createSubtaskForTask({ data: taskData }, parent_task_id);
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_get_subtasks",
    "Get subtasks of a task",
    {
      task_id: z.string().describe("Parent task GID"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ task_id, limit, offset, opt_fields }) => {
      const res = await tasks().getSubtasksForTask(task_id, {
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(
          opt_fields,
          "name,due_on,completed,assignee.name,resource_subtype,num_subtasks,parent.name"
        ),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_add_task_dependencies",
    "Set tasks that this task depends on",
    {
      task_id: z.string().describe("Task GID"),
      dependencies: z.array(z.string()).describe("GIDs of tasks this depends on"),
    },
    withErrorHandling(async ({ task_id, dependencies }) => {
      const res = await tasks().addDependenciesForTask({ data: { dependencies } }, task_id);
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_add_task_dependents",
    "Set tasks that depend on this task",
    {
      task_id: z.string().describe("Task GID"),
      dependents: z.array(z.string()).describe("GIDs of tasks that depend on this one"),
    },
    withErrorHandling(async ({ task_id, dependents }) => {
      const res = await tasks().addDependentsForTask({ data: { dependents } }, task_id);
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_add_project_to_task",
    "Add a task to a project",
    {
      task_id: z.string().describe("Task GID"),
      project_id: z.string().describe("Project GID to add the task to"),
      section: z.string().optional().describe("Section GID within the project"),
    },
    withErrorHandling(async ({ task_id, project_id, section }) => {
      await tasks().addProjectForTask({ data: { project: project_id, section } }, task_id);
      return textResult({ ok: true });
    })
  );

  server.tool(
    "asana_remove_project_from_task",
    "Remove a task from a project",
    {
      task_id: z.string().describe("Task GID"),
      project_id: z.string().describe("Project GID to remove the task from"),
    },
    withErrorHandling(async ({ task_id, project_id }) => {
      await tasks().removeProjectForTask({ data: { project: project_id } }, task_id);
      return textResult({ ok: true });
    })
  );

  server.tool(
    "asana_add_tag_to_task",
    "Add a tag to a task",
    {
      task_id: z.string().describe("Task GID"),
      tag_id: z.string().describe("Tag GID to add"),
    },
    withErrorHandling(async ({ task_id, tag_id }) => {
      await tasks().addTagForTask({ data: { tag: tag_id } }, task_id);
      return textResult({ ok: true });
    })
  );

  server.tool(
    "asana_remove_tag_from_task",
    "Remove a tag from a task",
    {
      task_id: z.string().describe("Task GID"),
      tag_id: z.string().describe("Tag GID to remove"),
    },
    withErrorHandling(async ({ task_id, tag_id }) => {
      await tasks().removeTagForTask({ data: { tag: tag_id } }, task_id);
      return textResult({ ok: true });
    })
  );

  server.tool(
    "asana_add_task_to_section",
    "Move a task to a section within a project",
    {
      section_id: z.string().describe("Section GID"),
      task_id: z.string().describe("Task GID to move"),
      insert_before: z.string().optional().describe("Task GID to insert before"),
      insert_after: z.string().optional().describe("Task GID to insert after"),
    },
    withErrorHandling(async ({ section_id, task_id, insert_before, insert_after }) => {
      await sections().addTaskForSection(section_id, { body: { data: { task: task_id, insert_before, insert_after } } });
      return textResult({ ok: true });
    })
  );

  server.tool(
    "asana_set_parent_for_task",
    "Set or change a task's parent",
    {
      task_id: z.string().describe("Task GID"),
      parent: z.string().describe("New parent task GID (empty string to remove parent)"),
    },
    withErrorHandling(async ({ task_id, parent }) => {
      const res = await tasks().setParentForTask({ data: { parent: parent || null } }, task_id);
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_add_followers",
    "Add followers (collaborators/watchers) to a task. Followers receive notifications about the task without being the assignee. Accepts user GIDs — resolve names or emails to GIDs with asana_typeahead.",
    {
      task_id: z.string().describe("Task GID"),
      followers: z.array(z.string()).min(1).describe("User GIDs (or 'me') to add as followers"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ task_id, followers, opt_fields }) => {
      const res = await tasks().addFollowersForTask({ data: { followers } }, task_id, {
        opt_fields: parseOptFields(opt_fields, "name,followers.name"),
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_remove_followers",
    "Remove followers (collaborators/watchers) from a task. Accepts user GIDs — resolve names or emails to GIDs with asana_typeahead.",
    {
      task_id: z.string().describe("Task GID"),
      followers: z.array(z.string()).min(1).describe("User GIDs (or 'me') to remove as followers"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ task_id, followers, opt_fields }) => {
      const res = await tasks().removeFollowerForTask({ data: { followers } }, task_id, {
        opt_fields: parseOptFields(opt_fields, "name,followers.name"),
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_duplicate_task",
    "Duplicate a task — the primitive for recurrence (duplicate a template or the previous occurrence to create the next one). Asana runs the duplication as an async job; this tool polls it for up to ~30s. If the job hasn't finished by then, it returns the job's gid with status 'still_running' instead of failing — the duplication keeps running server-side, so check back (e.g. via asana_get_task once you know the new task's gid, or re-run this tool's underlying job check) rather than retrying the duplication itself.",
    {
      task_id: z.string().describe("Task GID to duplicate"),
      name: z.string().optional().describe("Name for the duplicate. Defaults to Asana's own naming (based on the original) if omitted."),
      include: z
        .array(
          z.enum([
            "assignee",
            "attachments",
            "dates",
            "dependencies",
            "followers",
            "notes",
            "parent",
            "projects",
            "subtasks",
            "tags",
          ])
        )
        .optional()
        .describe("Which aspects of the original task to carry over to the duplicate. Omit to use Asana's own default set."),
      opt_fields: z.string().optional().describe("Comma-separated fields to include on the resulting task, once the job succeeds"),
    },
    withErrorHandling(async ({ task_id, name, include, opt_fields }) => {
      const newTaskFields = parseOptFields(opt_fields, "name,permalink_url");
      const jobOptFields = ["status", "new_task", ...newTaskFields.map((f) => `new_task.${f}`)];

      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (include !== undefined) body.include = include;

      // startAndPollJob guarantees the mutation (duplicateTask) runs exactly
      // once per tool call: an error from duplicateTask itself propagates (it
      // was rejected pre-execution, so withErrorHandling's 429 handler — which
      // re-invokes this WHOLE handler — may safely retry it), but any error
      // while polling the job is swallowed into pollError instead. Letting a
      // polling error escape would make that same retry create a SECOND
      // duplicate, and any other rethrow would orphan the job gid.
      const { job, timedOut, pollError } = await startAndPollJob(
        async () => {
          const res = await tasks().duplicateTask({ data: body }, task_id, {
            opt_fields: jobOptFields,
          });
          return res.data as JobLike;
        },
        async (jobGid) => {
          const res = await jobsApi().getJob(jobGid, { opt_fields: jobOptFields });
          return res.data as JobLike;
        }
      );

      if (timedOut) {
        return textResult({
          job_gid: job.gid,
          status: "still_running",
          note: pollError
            ? `Polling the duplication job failed (${pollError}) — the duplication itself was accepted and is still running server-side. Check the job later rather than retrying the duplication (a retry would create a second duplicate).`
            : "The duplication job hasn't finished within ~30s — it is still running server-side. Check back later (e.g. asana_get_task once you have the new task's gid) rather than retrying the duplication.",
        });
      }

      if (job.status === "failed") {
        throw new Error(`Task duplication job ${job.gid} failed.`);
      }

      return textResult({ job_gid: job.gid, status: job.status, new_task: job.new_task });
    })
  );
}

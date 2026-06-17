import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";

export function registerTasksTools(
  server: McpServer,
  ctx: ServiceContext
): void {
  const tasks = () => new Asana.TasksApi(ctx.apiClient);
  const sections = () => new Asana.SectionsApi(ctx.apiClient);

  server.tool(
    "asana_search_tasks",
    "Search tasks with advanced filters",
    {
      workspace: z.string().describe("Workspace GID"),
      text: z.string().optional().describe("Full-text search query"),
      assignee_any: z.string().optional().describe("Comma-separated user GIDs or 'me'"),
      due_on_before: z.string().optional().describe("Due date upper bound (YYYY-MM-DD)"),
      due_on_after: z.string().optional().describe("Due date lower bound (YYYY-MM-DD)"),
      due_on: z.string().optional().describe("Exact due date (YYYY-MM-DD)"),
      completed: z.boolean().optional().describe("Filter by completion status"),
      completed_on: z.string().optional().describe("Completed on date (YYYY-MM-DD)"),
      modified_on_after: z.string().optional().describe("Modified after (YYYY-MM-DD)"),
      projects_any: z.string().optional().describe("Comma-separated project GIDs"),
      sections_any: z.string().optional().describe("Comma-separated section GIDs"),
      tags_any: z.string().optional().describe("Comma-separated tag GIDs"),
      sort_by: z.enum(["due_date", "created_at", "completed_at", "modified_at"]).optional().describe("Sort field"),
      sort_ascending: z.boolean().optional().describe("Sort direction"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async (params) => {
      const { workspace, opt_fields, ...searchOpts } = params;
      const res = await tasks().searchTasksForWorkspace(workspace, {
        ...searchOpts,
        opt_fields: (opt_fields || "name,due_on,completed,assignee.name,projects.name,permalink_url").split(","),
      });
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_get_task",
    "Get full details of a task",
    {
      task_id: z.string().describe("Task GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async ({ task_id, opt_fields }) => {
      const res = await tasks().getTask(task_id, {
        opt_fields: (opt_fields || "name,notes,due_on,due_at,completed,assignee.name,projects.name,tags.name,custom_fields,permalink_url,parent.name,num_subtasks").split(","),
      });
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_get_multiple_tasks_by_gid",
    "Get details for up to 25 tasks by GID",
    {
      task_ids: z.array(z.string()).max(25).describe("Array of task GIDs (max 25)"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async ({ task_ids, opt_fields }) => {
      const fields = (opt_fields || "name,due_on,completed,assignee.name,projects.name,permalink_url").split(",");
      const results = await Promise.all(
        task_ids.map((id) => tasks().getTask(id, { opt_fields: fields }).then((r) => r.data))
      );
      return textResult(results);
    }
  );

  server.tool(
    "asana_get_my_tasks",
    "Get tasks assigned to the authenticated user",
    {
      workspace: z.string().describe("Workspace GID"),
      completed_since: z.string().optional().describe("Only incomplete tasks or tasks completed since this date ('now' for incomplete only)"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async ({ workspace, completed_since, opt_fields }) => {
      const res = await tasks().getTasks({
        workspace,
        assignee: "me",
        completed_since: completed_since || "now",
        opt_fields: (opt_fields || "name,due_on,due_at,completed,projects.name,permalink_url").split(","),
      });
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_get_tasks_for_project",
    "Get tasks in a project",
    {
      project_id: z.string().describe("Project GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async ({ project_id, opt_fields }) => {
      const res = await tasks().getTasksForProject(project_id, {
        opt_fields: (opt_fields || "name,due_on,completed,assignee.name,permalink_url").split(","),
      });
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_get_tasks_for_tag",
    "Get tasks with a specific tag",
    {
      tag_id: z.string().describe("Tag GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async ({ tag_id, opt_fields }) => {
      const res = await tasks().getTasksForTag(tag_id, {
        opt_fields: (opt_fields || "name,due_on,completed,assignee.name,permalink_url").split(","),
      });
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_create_task",
    "Create a new task",
    {
      project_id: z.string().describe("Project GID to create the task in"),
      name: z.string().describe("Task name"),
      notes: z.string().optional().describe("Task description"),
      html_notes: z.string().optional().describe("HTML-formatted task description"),
      due_on: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      assignee: z.string().optional().describe("Assignee GID or 'me'"),
      parent: z.string().optional().describe("Parent task GID"),
      projects: z.array(z.string()).optional().describe("Additional project GIDs"),
      resource_subtype: z
        .enum(["default_task", "milestone"])
        .optional()
        .describe(
          "Task subtype. 'default_task' is the standard unit of work; 'milestone' renders with a diamond icon and is the right call for project-level outcomes. Mutable via asana_update_task."
        ),
    },
    async ({ project_id, projects: extraProjects, ...taskData }) => {
      const allProjects = [project_id, ...(extraProjects || [])];
      const res = await tasks().createTask({ data: { ...taskData, projects: allProjects } });
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_update_task",
    "Update an existing task",
    {
      task_id: z.string().describe("Task GID to update"),
      name: z.string().optional().describe("New task name"),
      notes: z.string().optional().describe("New description"),
      html_notes: z.string().optional().describe("New HTML description"),
      due_on: z.string().optional().describe("New due date (YYYY-MM-DD)"),
      assignee: z.string().optional().describe("New assignee GID or 'me'"),
      completed: z.boolean().optional().describe("Mark as completed or not"),
      custom_fields: z.record(z.string(), z.unknown()).optional().describe("Custom field GID→value map"),
      resource_subtype: z
        .enum(["default_task", "milestone"])
        .optional()
        .describe(
          "Convert between task subtypes. Pass 'milestone' to mark a row as a milestone (diamond icon, used for project-level outcomes); 'default_task' converts back to a standard task. Mutation preserves gid, custom fields, subtasks, stories, and project membership."
        ),
    },
    async ({ task_id, ...updates }) => {
      const api = tasks() as unknown as Record<string, (...args: unknown[]) => Promise<Record<string, unknown>>>;
      const res = await api.updateTask({ data: updates }, task_id);
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_delete_task",
    "Delete a task permanently",
    {
      task_id: z.string().describe("Task GID to delete"),
    },
    async ({ task_id }) => {
      await tasks().deleteTask(task_id);
      return textResult({ ok: true, deleted: task_id });
    }
  );

  server.tool(
    "asana_create_subtask",
    "Create a subtask under a parent task",
    {
      parent_task_id: z.string().describe("Parent task GID"),
      name: z.string().describe("Subtask name"),
      notes: z.string().optional().describe("Subtask description"),
      due_on: z.string().optional().describe("Due date (YYYY-MM-DD)"),
      assignee: z.string().optional().describe("Assignee GID or 'me'"),
    },
    async ({ parent_task_id, ...taskData }) => {
      const res = await tasks().createSubtaskForTask({ data: taskData }, parent_task_id);
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_get_subtasks",
    "Get subtasks of a task",
    {
      task_id: z.string().describe("Parent task GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async ({ task_id, opt_fields }) => {
      const res = await tasks().getSubtasksForTask(task_id, {
        opt_fields: (opt_fields || "name,due_on,completed,assignee.name").split(","),
      });
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_add_task_dependencies",
    "Set tasks that this task depends on",
    {
      task_id: z.string().describe("Task GID"),
      dependencies: z.array(z.string()).describe("GIDs of tasks this depends on"),
    },
    async ({ task_id, dependencies }) => {
      const res = await tasks().addDependenciesForTask({ data: { dependencies } }, task_id);
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_add_task_dependents",
    "Set tasks that depend on this task",
    {
      task_id: z.string().describe("Task GID"),
      dependents: z.array(z.string()).describe("GIDs of tasks that depend on this one"),
    },
    async ({ task_id, dependents }) => {
      const res = await tasks().addDependentsForTask({ data: { dependents } }, task_id);
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_add_project_to_task",
    "Add a task to a project",
    {
      task_id: z.string().describe("Task GID"),
      project_id: z.string().describe("Project GID to add the task to"),
      section: z.string().optional().describe("Section GID within the project"),
    },
    async ({ task_id, project_id, section }) => {
      await tasks().addProjectForTask({ data: { project: project_id, section } }, task_id);
      return textResult({ ok: true });
    }
  );

  server.tool(
    "asana_remove_project_from_task",
    "Remove a task from a project",
    {
      task_id: z.string().describe("Task GID"),
      project_id: z.string().describe("Project GID to remove the task from"),
    },
    async ({ task_id, project_id }) => {
      await tasks().removeProjectForTask({ data: { project: project_id } }, task_id);
      return textResult({ ok: true });
    }
  );

  server.tool(
    "asana_add_tag_to_task",
    "Add a tag to a task",
    {
      task_id: z.string().describe("Task GID"),
      tag_id: z.string().describe("Tag GID to add"),
    },
    async ({ task_id, tag_id }) => {
      await tasks().addTagForTask({ data: { tag: tag_id } }, task_id);
      return textResult({ ok: true });
    }
  );

  server.tool(
    "asana_remove_tag_from_task",
    "Remove a tag from a task",
    {
      task_id: z.string().describe("Task GID"),
      tag_id: z.string().describe("Tag GID to remove"),
    },
    async ({ task_id, tag_id }) => {
      await tasks().removeTagForTask({ data: { tag: tag_id } }, task_id);
      return textResult({ ok: true });
    }
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
    async ({ section_id, task_id, insert_before, insert_after }) => {
      await sections().addTaskForSection(section_id, { body: { data: { task: task_id, insert_before, insert_after } } });
      return textResult({ ok: true });
    }
  );

  server.tool(
    "asana_set_parent_for_task",
    "Set or change a task's parent",
    {
      task_id: z.string().describe("Task GID"),
      parent: z.string().describe("New parent task GID (empty string to remove parent)"),
    },
    async ({ task_id, parent }) => {
      const res = await tasks().setParentForTask({ data: { parent: parent || null } }, task_id);
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_add_followers",
    "Add followers (collaborators/watchers) to a task. Followers receive notifications about the task without being the assignee. Accepts user GIDs — resolve names or emails to GIDs with asana_typeahead.",
    {
      task_id: z.string().describe("Task GID"),
      followers: z.array(z.string()).min(1).describe("User GIDs (or 'me') to add as followers"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async ({ task_id, followers, opt_fields }) => {
      const res = await tasks().addFollowersForTask({ data: { followers } }, task_id, {
        opt_fields: (opt_fields || "name,followers.name").split(","),
      });
      return textResult(res.data);
    }
  );

  server.tool(
    "asana_remove_followers",
    "Remove followers (collaborators/watchers) from a task. Accepts user GIDs — resolve names or emails to GIDs with asana_typeahead.",
    {
      task_id: z.string().describe("Task GID"),
      followers: z.array(z.string()).min(1).describe("User GIDs (or 'me') to remove as followers"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async ({ task_id, followers, opt_fields }) => {
      const res = await tasks().removeFollowerForTask({ data: { followers } }, task_id, {
        opt_fields: (opt_fields || "name,followers.name").split(","),
      });
      return textResult(res.data);
    }
  );
}

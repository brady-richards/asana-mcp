import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling } from "../../utils/errors.js";
import { parseOptFields } from "../../utils/optFields.js";
import { limitParam, offsetParam, paginationOpts, pagedResult } from "../../utils/pagination.js";
import { startAndPollJob, JobLike } from "../tasks/jobs.js";

export function registerTaskTemplatesTools(
  server: McpServer,
  ctx: ServiceContext
): void {
  const templates = () => new Asana.TaskTemplatesApi(ctx.apiClient);
  const jobsApi = () => new Asana.JobsApi(ctx.apiClient);

  server.tool(
    "asana_list_task_templates",
    "List the task templates defined on a project. Task templates are a separate resource type from tasks and project templates: neither asana_search_tasks nor asana_typeahead finds them, so this is the way to discover one.",
    {
      project: z.string().describe("Project GID whose task templates to list"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ project, limit, offset, opt_fields }) => {
      const res = await templates().getTaskTemplates({
        project,
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(opt_fields, "name,created_at"),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_get_task_template",
    "Get a task template, including the task it stamps out: `template.name`, `template.description`, `template.subtasks` (in template order), relative due/start dates, followers, custom fields and dependencies. asana_get_task does NOT work on a template gid.",
    {
      task_template_id: z.string().describe("Task template GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ task_template_id, opt_fields }) => {
      const res = await templates().getTaskTemplate(task_template_id, {
        ...(opt_fields ? { opt_fields: parseOptFields(opt_fields, "") } : {}),
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_instantiate_task_template",
    "Create a real task from a task template, carrying over its description, subtasks (in template order) and the rest of the template's settings. Prefer this to copying a template's subtasks one by one with asana_create_subtask, which adds each new subtask at the top and so reverses their order. Asana runs instantiation as an async job; this polls for up to ~30s and returns the new task. If the job hasn't finished by then it returns the job gid with status 'still_running' rather than failing — instantiation continues server-side, so check back instead of re-running this tool (a re-run would create a second task).",
    {
      task_template_id: z.string().describe("Task template GID to instantiate"),
      name: z
        .string()
        .optional()
        .describe("Name for the new task. Defaults to the template's task name when omitted."),
      opt_fields: z
        .string()
        .optional()
        .describe("Comma-separated fields to include on the resulting task, once the job succeeds"),
    },
    withErrorHandling(async ({ task_template_id, name, opt_fields }) => {
      const newTaskFields = parseOptFields(
        opt_fields,
        "name,permalink_url,projects.name,num_subtasks"
      );
      const jobOptFields = ["status", "new_task", ...newTaskFields.map((f) => `new_task.${f}`)];

      // Same contract as asana_instantiate_project_template: an error from
      // instantiateTask propagates, but an error while polling is swallowed into
      // pollError so withErrorHandling's 429 retry can't create a SECOND task.
      const { job, timedOut, pollError } = await startAndPollJob(
        async () => {
          const res = await templates().instantiateTask(task_template_id, {
            body: { data: name ? { name } : {} },
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
            ? `Polling the instantiation job failed (${pollError}) — instantiation itself was accepted and is still running server-side. Check the job later rather than re-running this tool (a re-run would create a second task).`
            : "The instantiation job hasn't finished within ~30s — it is still running server-side. Check back later rather than re-running this tool, which would create a second task.",
        });
      }

      if (job.status === "failed") {
        throw new Error(`Task instantiation job ${job.gid} failed.`);
      }

      return textResult({
        job_gid: job.gid,
        status: job.status,
        new_task: (job as { new_task?: unknown }).new_task,
      });
    })
  );
}

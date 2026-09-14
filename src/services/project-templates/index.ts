import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling } from "../../utils/errors.js";
import { parseOptFields } from "../../utils/optFields.js";
import { limitParam, offsetParam, paginationOpts, pagedResult } from "../../utils/pagination.js";
import { startAndPollJob, JobLike } from "../tasks/jobs.js";
import {
  buildInstantiateBody,
  requestedDateSchema,
  requestedRoleSchema,
} from "./instantiateBody.js";

export function registerProjectTemplatesTools(
  server: McpServer,
  ctx: ServiceContext
): void {
  const templates = () => new Asana.ProjectTemplatesApi(ctx.apiClient);
  const workspaces = () => new Asana.WorkspacesApi(ctx.apiClient);
  const jobsApi = () => new Asana.JobsApi(ctx.apiClient);

  server.tool(
    "asana_get_project_template",
    "Get a project template, including the variables it needs filled in to instantiate. Read this BEFORE asana_instantiate_project_template: the `requested_dates` and `requested_roles` arrays carry the GIDs that instantiation binds values to, and they can't be guessed from the names. Note asana_get_project does NOT work on a template gid — templates are a separate resource type.",
    {
      project_template_id: z.string().describe("Project template GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ project_template_id, opt_fields }) => {
      const res = await templates().getProjectTemplate(project_template_id, {
        opt_fields: parseOptFields(
          opt_fields,
          "name,description,public,color,owner.name,team.name,requested_dates,requested_roles"
        ),
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_list_project_templates",
    "List project templates in a workspace. asana_typeahead with resource_type 'project_template' is usually the faster way to find one by name; this is for enumerating them.",
    {
      workspace: z.string().describe("Workspace GID"),
      team: z.string().optional().describe("Restrict to templates owned by this team"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ workspace, team, limit, offset, opt_fields }) => {
      const res = await templates().getProjectTemplates({
        workspace,
        ...(team ? { team } : {}),
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(opt_fields, "name,team.name,owner.name"),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_list_project_templates_for_team",
    "List the project templates belonging to one team. Same data as asana_list_project_templates with a team filter, via Asana's team-scoped endpoint — use this when you have a team GID and no workspace GID.",
    {
      team_id: z.string().describe("Team GID"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ team_id, limit, offset, opt_fields }) => {
      const res = await templates().getProjectTemplatesForTeam(team_id, {
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(opt_fields, "name,team.name,owner.name"),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_instantiate_project_template",
    "Create a real project from a project template, carrying over its sections, tasks and task descriptions. Call asana_get_project_template first to read the `requested_dates` and `requested_roles` GIDs this needs. Asana runs instantiation as an async job; this polls for up to ~30s and returns the new project. If the job hasn't finished by then it returns the job gid with status 'still_running' rather than failing — instantiation continues server-side, so check back instead of re-running this tool (a re-run would create a second project).",
    {
      project_template_id: z.string().describe("Project template GID to instantiate"),
      name: z.string().describe("Name for the new project"),
      team: z
        .string()
        .optional()
        .describe(
          "Team GID to create the project in. REQUIRED when the workspace is an organization; resolved from the template's own team when omitted."
        ),
      public: z
        .boolean()
        .optional()
        .describe(
          "Whether the new project is public to the workspace. Only meaningful outside an organization — ignored when the workspace is one, where team membership governs visibility instead."
        ),
      requested_dates: z
        .array(requestedDateSchema)
        .optional()
        .describe(
          "Values for the template's date variables, from its requested_dates array. A template that declares one (e.g. 'Start Date') expects it here."
        ),
      requested_roles: z
        .array(requestedRoleSchema)
        .optional()
        .describe(
          "User GIDs filling the template's roles, from its requested_roles array. Tasks assigned to a role in the template go to that user."
        ),
      opt_fields: z
        .string()
        .optional()
        .describe("Comma-separated fields to include on the resulting project, once the job succeeds"),
    },
    withErrorHandling(async ({
      project_template_id,
      name,
      team,
      public: isPublic,
      requested_dates,
      requested_roles,
      opt_fields,
    }) => {
      const newProjectFields = parseOptFields(opt_fields, "name,permalink_url");
      const jobOptFields = [
        "status",
        "new_project",
        ...newProjectFields.map((f) => `new_project.${f}`),
      ];

      // Both facts have to come off the wire before the body can be shaped:
      // whether a team is mandatory depends on the workspace kind, and the
      // template's own team is the only sensible default when the caller
      // didn't name one.
      const templateRes = await templates().getProjectTemplate(project_template_id, {
        opt_fields: ["team.gid"],
      });
      const resolvedTeam = team ?? (templateRes.data?.team?.gid as string | undefined);

      const workspaceRes = await workspaces().getWorkspaces({
        limit: 1,
        opt_fields: ["is_organization"],
      });
      const isOrganization = Boolean(workspaceRes.data?.[0]?.is_organization);

      const body = buildInstantiateBody({
        name,
        team: resolvedTeam,
        public: isPublic,
        requested_dates,
        requested_roles,
        is_organization: isOrganization,
      });

      // Same contract as asana_duplicate_task: an error from instantiateProject
      // propagates (rejected before it ran, so withErrorHandling's 429 retry of
      // the whole handler is safe), but an error while polling is swallowed into
      // pollError — letting it escape would make that retry instantiate a SECOND
      // project, and any other rethrow would orphan the job gid.
      const { job, timedOut, pollError } = await startAndPollJob(
        async () => {
          const res = await templates().instantiateProject(project_template_id, {
            body: { data: body },
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
            ? `Polling the instantiation job failed (${pollError}) — instantiation itself was accepted and is still running server-side. Check the job later rather than re-running this tool (a re-run would create a second project).`
            : "The instantiation job hasn't finished within ~30s — it is still running server-side. Check back later rather than re-running this tool, which would create a second project.",
        });
      }

      if (job.status === "failed") {
        throw new Error(`Project instantiation job ${job.gid} failed.`);
      }

      return textResult({
        job_gid: job.gid,
        status: job.status,
        new_project: (job as { new_project?: unknown }).new_project,
      });
    })
  );
}

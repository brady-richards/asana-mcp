import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling } from "../../utils/errors.js";
import { parseOptFields } from "../../utils/optFields.js";
import { limitParam, offsetParam, paginationOpts, pagedResult } from "../../utils/pagination.js";
import { resolveStatusType } from "./statusType.js";

export function registerProjectsTools(
  server: McpServer,
  ctx: ServiceContext
): void {
  const workspaces = () => new Asana.WorkspacesApi(ctx.apiClient);
  const projects = () => new Asana.ProjectsApi(ctx.apiClient);
  // ProjectStatusesApi (/project_statuses) is deprecated in favor of the
  // unified StatusUpdatesApi (/status_updates?parent=), which also covers
  // portfolio and goal status updates — see node_modules/asana/src/api/StatusUpdatesApi.d.ts.
  // Tool names/params below are unchanged (only status_type is new) so existing
  // callers aren't affected by the backend swap.
  const statusUpdates = () => new Asana.StatusUpdatesApi(ctx.apiClient);

  server.tool(
    "asana_list_workspaces",
    "List all workspaces the authenticated user belongs to",
    {},
    withErrorHandling(async () => {
      const res = await workspaces().getWorkspaces({});
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_search_projects",
    "Search for projects by name pattern (regex) within one page of the workspace's projects. Paginate with limit/offset to scan further pages — matches are found only within the fetched page, not the whole workspace.",
    {
      workspace: z.string().describe("Workspace GID"),
      name_pattern: z.string().describe("Regex pattern to match project names"),
      archived: z.boolean().optional().default(false).describe("Only return archived projects"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ workspace, name_pattern, archived, limit, offset, opt_fields }) => {
      let regex: RegExp;
      try {
        regex = new RegExp(name_pattern, "i");
      } catch (e) {
        throw new Error(`Invalid regular expression in name_pattern: ${(e as Error).message}`);
      }

      // `name` must always be fetched — it's what the regex matches against —
      // even if the caller's opt_fields omits it.
      const requestedFields = parseOptFields(opt_fields, "name,archived,color,current_status");
      const fetchFields = requestedFields.includes("name")
        ? requestedFields
        : ["name", ...requestedFields];

      const res = await projects().getProjectsForWorkspace(workspace, {
        archived,
        ...paginationOpts(limit, offset),
        opt_fields: fetchFields,
      });
      const matches = (res.data || []).filter((p: Record<string, unknown>) =>
        regex.test(p.name as string)
      );
      return textResult(pagedResult({ data: matches, _response: res._response }));
    })
  );

  server.tool(
    "asana_get_project",
    "Get detailed information about a project",
    {
      project_id: z.string().describe("Project GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ project_id, opt_fields }) => {
      const res = await projects().getProject(project_id, {
        opt_fields: parseOptFields(
          opt_fields,
          "name,notes,archived,color,current_status,owner.name,team.name,permalink_url"
        ),
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_create_project",
    "Create a new project in a workspace",
    {
      workspace: z.string().describe("Workspace GID"),
      name: z.string().describe("Project name"),
      notes: z.string().optional().describe("Project description"),
      color: z
        .string()
        .optional()
        .describe(
          "Project icon color. Asana's project palette uses light- / dark- prefixes — valid values include: light-pink, light-green, light-blue, light-red, light-teal, light-brown, light-orange, light-purple, light-warm-gray, dark-pink, dark-green, dark-blue, dark-red, dark-teal, dark-brown, dark-orange, dark-purple, dark-warm-gray, none. Note: this is a DIFFERENT palette than enum-option colors (those are red/blue/blue-green/etc. without prefixes)."
        ),
      team: z.string().optional().describe("Team GID"),
      privacy_setting: z
        .enum(["public_to_workspace", "private_to_team", "private"])
        .optional()
        .describe(
          "Project visibility. public_to_workspace = anyone in the workspace can view (best for cross-functional boards). private_to_team = team members only. private = explicit members only. Defaults to private if omitted."
        ),
      default_view: z
        .enum(["list", "board", "calendar", "timeline"])
        .optional()
        .describe("Default view mode when opening the project. Defaults to list if omitted."),
    },
    withErrorHandling(async ({ workspace, ...projectData }) => {
      const res = await projects().createProjectForWorkspace({ data: projectData }, workspace);
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_update_project",
    "Update a project's details",
    {
      project_id: z.string().describe("Project GID"),
      name: z.string().optional().describe("New project name"),
      notes: z.string().optional().describe("New description"),
      archived: z.boolean().optional().describe("Archive or unarchive"),
      color: z
        .string()
        .optional()
        .describe(
          "New project icon color. Valid values: light-pink, light-green, light-blue, light-red, light-teal, light-brown, light-orange, light-purple, light-warm-gray, dark-pink, dark-green, dark-blue, dark-red, dark-teal, dark-brown, dark-orange, dark-purple, dark-warm-gray, none. (Different palette from enum-option colors.)"
        ),
      privacy_setting: z
        .enum(["public_to_workspace", "private_to_team", "private"])
        .optional()
        .describe("Project visibility. public_to_workspace makes the project readable by anyone in the workspace."),
      default_view: z
        .enum(["list", "board", "calendar", "timeline"])
        .optional()
        .describe("Default view mode when opening the project."),
    },
    withErrorHandling(async ({ project_id, ...updates }) => {
      const res = await projects().updateProject({ data: updates }, project_id);
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_get_project_task_counts",
    "Get task counts for a project",
    {
      project_id: z.string().describe("Project GID"),
    },
    withErrorHandling(async ({ project_id }) => {
      const res = await projects().getProject(project_id, {
        opt_fields: ["name", "num_tasks", "num_incomplete_tasks"],
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_get_project_statuses",
    "List status updates for a project",
    {
      project_id: z.string().describe("Project GID"),
    },
    withErrorHandling(async ({ project_id }) => {
      const res = await statusUpdates().getStatusesForObject(project_id, {});
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_get_project_status",
    "Get a specific project status update",
    {
      status_id: z.string().describe("Project status GID"),
    },
    withErrorHandling(async ({ status_id }) => {
      const res = await statusUpdates().getStatus(status_id, {});
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_create_project_status",
    "Create a status update for a project. The underlying StatusUpdate resource is keyed on status_type, not color — when status_type is omitted it is derived from color (green→on_track, yellow→at_risk, red→off_track), and color itself is never sent to the API. The response is a status_update record (no color field).",
    {
      project_id: z.string().describe("Project GID"),
      text: z.string().describe("Status text"),
      color: z
        .enum(["green", "yellow", "red"])
        .describe(
          "Status color — used only to derive status_type when that isn't given (green→on_track, yellow→at_risk, red→off_track); not sent to the API."
        ),
      title: z.string().optional().describe("Status title"),
      status_type: z
        .enum(["on_track", "at_risk", "off_track", "on_hold", "complete", "dropped"])
        .optional()
        .describe(
          "Structured status signal, surfaced in status rollups. Overrides the color-derived value when given."
        ),
    },
    withErrorHandling(async ({ project_id, color, status_type, ...statusData }) => {
      // POST /status_updates requires status_type and its request schema has
      // no color property — see statusType.ts.
      const res = await statusUpdates().createStatusForObject({
        data: {
          parent: project_id,
          status_type: resolveStatusType(color, status_type),
          ...statusData,
        },
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_delete_project_status",
    "Delete a project status update",
    {
      status_id: z.string().describe("Project status GID"),
    },
    withErrorHandling(async ({ status_id }) => {
      await statusUpdates().deleteStatus(status_id);
      return textResult({ ok: true, deleted: status_id });
    })
  );
}

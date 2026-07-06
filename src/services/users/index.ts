import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling } from "../../utils/errors.js";
import { parseOptFields } from "../../utils/optFields.js";
import { limitParam, offsetParam, paginationOpts, pagedResult } from "../../utils/pagination.js";
import { resolveDefaultWorkspace } from "../../utils/workspace.js";
import { classifyUserIdentifier, buildGetUserOpts } from "./routing.js";

export function registerUsersTools(server: McpServer, ctx: ServiceContext): void {
  const users = () => new Asana.UsersApi(ctx.apiClient);
  const teams = () => new Asana.TeamsApi(ctx.apiClient);

  server.tool(
    "asana_get_users_for_workspace",
    "List users in a workspace (compact records: gid, name, email). Defaults to the account's configured workspace when workspace_id is omitted.",
    {
      workspace_id: z
        .string()
        .optional()
        .describe("Workspace GID. Defaults to the account's own workspace if omitted."),
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ workspace_id, offset, opt_fields }) => {
      const workspace = workspace_id ?? (await resolveDefaultWorkspace(ctx));
      const res = await users().getUsersForWorkspace(workspace, {
        ...(offset ? { offset } : {}),
        opt_fields: parseOptFields(opt_fields, "name,email"),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_get_user",
    "Get a user's full record. Accepts a user GID, the literal string 'me', or an email address.",
    {
      user_id: z.string().describe("User GID, 'me', or an email address"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ user_id, opt_fields }) => {
      const fields = parseOptFields(opt_fields, "name,email");
      // An email is only unambiguous within a single workspace (the same
      // address can be a different Asana user in a different org), so scope
      // the lookup with `workspace` in that case only — see routing.ts.
      const workspace =
        classifyUserIdentifier(user_id) === "email" ? await resolveDefaultWorkspace(ctx) : undefined;
      const opts = buildGetUserOpts(user_id, fields, workspace);
      const res = await users().getUser(user_id, opts);
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_get_teams_for_workspace",
    "List teams in a workspace",
    {
      workspace: z.string().describe("Workspace GID"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ workspace, limit, offset, opt_fields }) => {
      const res = await teams().getTeamsForWorkspace(workspace, {
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(opt_fields, "name"),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_get_users_for_team",
    "List users that are members of a team (compact records: gid, name). Results are sorted alphabetically and capped at 2000 by Asana — use asana_get_users_for_workspace for more.",
    {
      team_id: z.string().describe("Team GID"),
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ team_id, offset, opt_fields }) => {
      const res = await users().getUsersForTeam(team_id, {
        ...(offset ? { offset } : {}),
        opt_fields: parseOptFields(opt_fields, "name,email"),
      });
      return textResult(pagedResult(res));
    })
  );
}

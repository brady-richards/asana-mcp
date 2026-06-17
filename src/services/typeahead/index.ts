import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";

export function registerTypeaheadTools(
  server: McpServer,
  ctx: ServiceContext
): void {
  const typeahead = () => new Asana.TypeaheadApi(ctx.apiClient);

  server.tool(
    "asana_typeahead",
    "Autocomplete search within a workspace — resolve a partial name or email into matching objects and their GIDs. Use resource_type 'user' to find a person's GID for @mentions (asana_create_task_story html_text) or asana_add_followers / asana_remove_followers.",
    {
      workspace: z.string().describe("Workspace GID"),
      resource_type: z
        .enum([
          "user",
          "project",
          "task",
          "tag",
          "portfolio",
          "project_template",
          "goal",
          "team",
          "custom_field",
        ])
        .describe("Type of object to search for"),
      query: z.string().optional().describe("Partial name or email to match (omit to list recents)"),
      count: z.number().int().min(1).max(100).optional().describe("Max results (1-100; server default 20 when omitted)"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    async ({ workspace, resource_type, query, count, opt_fields }) => {
      const defaultFields = resource_type === "user" ? "name,email" : "name";
      const opts: { query?: string; count?: number; opt_fields: string[] } = {
        opt_fields: (opt_fields || defaultFields).split(","),
      };
      if (query) opts.query = query;
      if (count) opts.count = count;
      const res = await typeahead().typeaheadForWorkspace(workspace, resource_type, opts);
      return textResult(res.data);
    }
  );
}

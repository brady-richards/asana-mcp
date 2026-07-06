import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling } from "../../utils/errors.js";
import { parseOptFields } from "../../utils/optFields.js";
import { limitParam, offsetParam, paginationOpts, pagedResult } from "../../utils/pagination.js";

export function registerStoriesTools(
  server: McpServer,
  ctx: ServiceContext
): void {
  const stories = () => new Asana.StoriesApi(ctx.apiClient);

  server.tool(
    "asana_get_task_stories",
    "Get comments and activity on a task",
    {
      task_id: z.string().describe("Task GID"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ task_id, limit, offset, opt_fields }) => {
      const res = await stories().getStoriesForTask(task_id, {
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(opt_fields, "text,created_by.name,created_at,type,resource_subtype"),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_create_task_story",
    "Add a comment to a task. Provide exactly one of `text` (plain) or `html_text` (Asana rich-text HTML subset). Use html_text to @mention people: include <a data-asana-gid=\"USER_GID\"/> (resolve GIDs with asana_typeahead). @mentioning a user also adds them as a follower.",
    {
      task_id: z.string().describe("Task GID"),
      text: z.string().optional().describe("Plain-text comment body"),
      html_text: z
        .string()
        .optional()
        .describe(
          'HTML-formatted comment body (Asana rich-text subset, wrapped in <body>...</body>). @mention with <a data-asana-gid="GID"/>.'
        ),
    },
    withErrorHandling(async ({ task_id, text, html_text }) => {
      if (!text && !html_text) {
        throw new Error("asana_create_task_story requires either `text` or `html_text`.");
      }
      if (text && html_text) {
        throw new Error("asana_create_task_story accepts only one of `text` or `html_text`, not both.");
      }
      const data = html_text ? { html_text } : { text };
      const res = await stories().createStoryForTask({ data }, task_id);
      return textResult(res.data);
    })
  );
}

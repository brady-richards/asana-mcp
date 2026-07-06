import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServiceContext } from "./types.js";
import { registerTasksTools } from "./services/tasks/index.js";
import { registerProjectsTools } from "./services/projects/index.js";
import { registerSectionsTools } from "./services/sections/index.js";
import { registerTagsTools } from "./services/tags/index.js";
import { registerStoriesTools } from "./services/stories/index.js";
import { registerCustomFieldsTools } from "./services/custom-fields/index.js";
import { registerTypeaheadTools } from "./services/typeahead/index.js";
import { registerAttachmentsTools } from "./services/attachments/index.js";
import { registerUsersTools } from "./services/users/index.js";
import { registerEventsTools } from "./services/events/index.js";

export function createServer(ctx: ServiceContext): McpServer {
  const server = new McpServer({
    name: "asana-mcp",
    version: "0.1.0",
  });

  registerTasksTools(server, ctx);
  registerProjectsTools(server, ctx);
  registerSectionsTools(server, ctx);
  registerTagsTools(server, ctx);
  registerStoriesTools(server, ctx);
  registerCustomFieldsTools(server, ctx);
  registerTypeaheadTools(server, ctx);
  registerAttachmentsTools(server, ctx);
  registerUsersTools(server, ctx);
  registerEventsTools(server, ctx);

  return server;
}

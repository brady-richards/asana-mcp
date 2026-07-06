import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling } from "../../utils/errors.js";
import { parseOptFields } from "../../utils/optFields.js";
import { isPreconditionFailed, extractSyncToken } from "./sync.js";

interface EventsResponse {
  data?: unknown[];
  _response?: { sync?: string; has_more?: boolean };
}

export function registerEventsTools(server: McpServer, ctx: ServiceContext): void {
  const events = () => new Asana.EventsApi(ctx.apiClient);

  server.tool(
    "asana_get_events",
    "Get changes to a resource (task, project, or goal) since a sync token — a change-detection primitive for polling instead of re-fetching whole objects. On the first call (or once a sync token has expired), Asana responds with a fresh sync token and no events instead of an error; this tool surfaces that as a normal response. Store the returned sync token and pass it back in as sync_token on the next call to get only what changed since.",
    {
      resource_gid: z.string().describe("GID of the task, project, or goal to watch"),
      sync_token: z
        .string()
        .optional()
        .describe("Sync token from a previous call. Omit on the first call."),
      opt_fields: z.string().optional().describe("Comma-separated fields to include on each event's resource"),
    },
    withErrorHandling(async ({ resource_gid, sync_token, opt_fields }) => {
      const opts: { sync?: string; opt_fields: string[] } = {
        opt_fields: parseOptFields(
          opt_fields,
          "action,created_at,resource.name,resource.resource_type,parent.name,user.name"
        ),
      };
      if (sync_token) opts.sync = sync_token;

      try {
        const res = (await events().getEvents(resource_gid, opts)) as EventsResponse;
        return textResult({
          sync: res._response?.sync,
          has_more: res._response?.has_more ?? false,
          data: res.data ?? [],
        });
      } catch (e) {
        // A 412 with a fresh sync token is Asana's normal "first sync, or your
        // token expired" response, not a real error — see sync.ts and this
        // tool's description. Any other failure (network, 429, a 412 with no
        // usable token, ...) falls through to `throw e`, which withErrorHandling
        // (wrapping this whole function) processes exactly as it would for any
        // other tool: 429 gets one retry, everything else becomes a clean Error.
        if (isPreconditionFailed(e)) {
          const freshSync = extractSyncToken(e);
          if (freshSync) {
            return textResult({
              sync: freshSync,
              has_more: false,
              data: [],
              note: sync_token
                ? "The previous sync token had expired — Asana issued a fresh one, with no events attached. Store it and retry from here; if you need to know what changed before this point, re-fetch the resource directly."
                : "First sync for this resource — no events yet. Store this token and pass it as sync_token on your next call.",
            });
          }
        }
        throw e;
      }
    })
  );
}

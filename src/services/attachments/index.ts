import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import fs from "node:fs";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling } from "../../utils/errors.js";
import { parseOptFields } from "../../utils/optFields.js";
import { limitParam, offsetParam, paginationOpts, pagedResult } from "../../utils/pagination.js";
import { assertExactlyOneOf } from "../tasks/validation.js";
import { defaultAttachmentName } from "./naming.js";

// The generated .d.ts types `opts.file` as `string`, but the JS implementation
// (ApiClient.isFileParam — see node_modules/asana/src/ApiClient.js) actually
// duck-types it: a Buffer or a readable stream (fs.ReadStream included) is
// detected and sent via superagent's `.attach()` as multipart file content,
// not as a plain string field. The type is simply stale/wrong for this param.
type CreateAttachmentOpts = NonNullable<
  Parameters<InstanceType<typeof Asana.AttachmentsApi>["createAttachmentForObject"]>[0]
>;

export function registerAttachmentsTools(server: McpServer, ctx: ServiceContext): void {
  const attachments = () => new Asana.AttachmentsApi(ctx.apiClient);

  server.tool(
    "asana_get_attachments_for_task",
    "List attachments on a task (compact records: name, download_url, host, resource_subtype, size). Note: download_url is a short-lived signed URL — fetch it promptly, don't cache it.",
    {
      task_id: z.string().describe("Task GID"),
      limit: limitParam,
      offset: offsetParam,
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ task_id, limit, offset, opt_fields }) => {
      const res = await attachments().getAttachmentsForObject(task_id, {
        ...paginationOpts(limit, offset),
        opt_fields: parseOptFields(opt_fields, "name,download_url,host,resource_subtype,size"),
      });
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_get_attachment",
    "Get the full record for a single attachment, including its download_url. Note: download_url is a short-lived signed URL — fetch it promptly, don't cache it.",
    {
      attachment_id: z.string().describe("Attachment GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ attachment_id, opt_fields }) => {
      const res = await attachments().getAttachment(attachment_id, {
        opt_fields: parseOptFields(
          opt_fields,
          "name,download_url,host,resource_subtype,size,view_url,permanent_url,created_at,parent.name"
        ),
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_upload_attachment",
    "Attach a file to a task — either a link to an external URL, or a local file uploaded as multipart/form-data (Asana's 100MB attachment size limit applies). Provide exactly one of url or local_path.",
    {
      task_id: z.string().describe("Task GID to attach to"),
      url: z
        .string()
        .optional()
        .describe(
          "External URL to reference — creates a resource_subtype: external attachment (no file content is uploaded). Mutually exclusive with local_path."
        ),
      local_path: z
        .string()
        .optional()
        .describe(
          "Absolute path to a local file whose contents will be uploaded as the attachment. Mutually exclusive with url."
        ),
      name: z
        .string()
        .optional()
        .describe("Display name for the attachment. Defaults to the URL, or the local file's basename."),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ task_id, url, local_path, name, opt_fields }) => {
      assertExactlyOneOf({ url, local_path }, ["url", "local_path"]);
      const attachmentName = defaultAttachmentName({ name, url, local_path });

      const uploadOpts: CreateAttachmentOpts = {
        parent: task_id,
        name: attachmentName,
        opt_fields: parseOptFields(opt_fields, "name,download_url,host,resource_subtype,size"),
      };

      if (url !== undefined) {
        uploadOpts.resource_subtype = "external";
        uploadOpts.url = url;
      } else {
        const filePath = local_path as string;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(filePath);
        } catch {
          throw new Error(`local_path does not exist or is not readable: ${filePath}`);
        }
        if (!stat.isFile()) {
          throw new Error(`local_path is not a regular file: ${filePath}`);
        }
        // See the CreateAttachmentOpts comment above — this is a real
        // fs.ReadStream, not a string; the .d.ts's `file: string` typing is stale.
        uploadOpts.file = fs.createReadStream(filePath) as unknown as string;
      }

      const res = await attachments().createAttachmentForObject(uploadOpts);
      return textResult(res.data);
    })
  );
}

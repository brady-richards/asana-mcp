import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling } from "../../utils/errors.js";
import { parseOptFields } from "../../utils/optFields.js";

export function registerCustomFieldsTools(
  server: McpServer,
  ctx: ServiceContext
): void {
  const customFields = () => new Asana.CustomFieldsApi(ctx.apiClient);
  const projects = () => new Asana.ProjectsApi(ctx.apiClient);

  server.tool(
    "asana_get_custom_fields_for_workspace",
    "List all custom field definitions in a workspace. Returns gid, name, resource_subtype, and enum_options for each field.",
    {
      workspace: z.string().describe("Workspace GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ workspace, opt_fields }) => {
      const res = await customFields().getCustomFieldsForWorkspace(workspace, {
        opt_fields: parseOptFields(
          opt_fields,
          "gid,name,resource_subtype,description,enum_options.gid,enum_options.name,enum_options.color,enum_options.enabled"
        ),
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_get_custom_field",
    "Get full details for a custom field by GID",
    {
      custom_field_gid: z.string().describe("Custom field GID"),
      opt_fields: z.string().optional().describe("Comma-separated fields to include"),
    },
    withErrorHandling(async ({ custom_field_gid, opt_fields }) => {
      const res = await customFields().getCustomField(custom_field_gid, {
        opt_fields: parseOptFields(
          opt_fields,
          "gid,name,resource_subtype,description,enum_options.gid,enum_options.name,enum_options.color,enum_options.enabled,precision,format,is_global_to_workspace"
        ),
      });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_create_custom_field",
    "Create a workspace-level custom field. For enum/multi_enum types, pass enum_options as an array of {name, color?} in display order — the response includes generated GIDs for the field and every option, so a single call gives you everything needed to assign values via asana_update_task.",
    {
      workspace: z.string().describe("Workspace GID"),
      name: z.string().describe("Field display name"),
      resource_subtype: z.enum(["text", "number", "enum", "multi_enum", "date", "people"]).describe("Field type"),
      description: z.string().optional().describe("Field description"),
      enum_options: z
        .array(
          z.object({
            name: z.string(),
            color: z
            .string()
            .optional()
            .describe(
              "Enum-option color. Valid values: red, magenta, hot-pink, pink, purple, indigo, blue, blue-green, green, yellow-green, yellow, yellow-orange, orange, cool-gray, none. NOTE: this is a DIFFERENT palette than project icon colors (those use light-/dark- prefixes). 'red-orange' is NOT valid and will return Forbidden."
            ),
            enabled: z.boolean().optional(),
          })
        )
        .optional()
        .describe("Enum option definitions (for enum/multi_enum subtypes)"),
      precision: z.number().int().optional().describe("Decimal precision (for number subtype)"),
      format: z
        .enum(["currency", "percentage", "duration", "none"])
        .optional()
        .describe("Number formatting (for number subtype)"),
      currency_code: z.string().optional().describe("ISO 4217 currency code (for currency-formatted number)"),
      custom_label: z.string().optional().describe("Custom label suffix for number fields"),
      is_global_to_workspace: z.boolean().optional().describe("Whether the field is reusable across projects in the workspace"),
    },
    withErrorHandling(async (data) => {
      const res = await customFields().createCustomField({ data });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_update_custom_field",
    "Update a custom field's metadata. Note: resource_subtype cannot be changed after creation.",
    {
      custom_field_gid: z.string().describe("Custom field GID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      precision: z.number().int().optional().describe("New decimal precision (number subtype)"),
      format: z.enum(["currency", "percentage", "duration", "none"]).optional(),
      currency_code: z.string().optional(),
      custom_label: z.string().optional(),
    },
    withErrorHandling(async ({ custom_field_gid, ...updates }) => {
      const res = await customFields().updateCustomField(custom_field_gid, { body: { data: updates } });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_delete_custom_field",
    "Delete a custom field permanently. Removes the field from all tasks and projects in the workspace.",
    {
      custom_field_gid: z.string().describe("Custom field GID"),
    },
    withErrorHandling(async ({ custom_field_gid }) => {
      await customFields().deleteCustomField(custom_field_gid);
      return textResult({ ok: true, deleted: custom_field_gid });
    })
  );

  server.tool(
    "asana_create_enum_option",
    "Add a new enum option to an existing enum custom field. Useful when growing an enum taxonomy without rebuilding the field.",
    {
      custom_field_gid: z.string().describe("Custom field GID (must be enum/multi_enum type)"),
      name: z.string().describe("Option display name"),
      color: z
        .string()
        .optional()
        .describe(
          "Enum-option color. Valid values: red, magenta, hot-pink, pink, purple, indigo, blue, blue-green, green, yellow-green, yellow, yellow-orange, orange, cool-gray, none."
        ),
      enabled: z.boolean().optional().describe("Whether the option is selectable"),
      insert_before: z.string().optional().describe("Existing enum option GID to insert before"),
      insert_after: z.string().optional().describe("Existing enum option GID to insert after"),
    },
    withErrorHandling(async ({ custom_field_gid, ...data }) => {
      const res = await customFields().createEnumOptionForCustomField(custom_field_gid, { body: { data } });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_update_enum_option",
    "Update an enum option's name, color, or enabled state. Disabling preserves history without deletion.",
    {
      enum_option_gid: z.string().describe("Enum option GID"),
      name: z.string().optional(),
      color: z
        .string()
        .optional()
        .describe(
          "Enum-option color. Valid values: red, magenta, hot-pink, pink, purple, indigo, blue, blue-green, green, yellow-green, yellow, yellow-orange, orange, cool-gray, none."
        ),
      enabled: z.boolean().optional(),
    },
    withErrorHandling(async ({ enum_option_gid, ...updates }) => {
      const res = await customFields().updateEnumOption(enum_option_gid, { body: { data: updates } });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_add_custom_field_to_project",
    "Attach an existing workspace custom field to a project so tasks in that project can set its value. Returns the custom field setting record.",
    {
      project_id: z.string().describe("Project GID"),
      custom_field: z.string().describe("Custom field GID to attach"),
      is_important: z.boolean().optional().describe("Pin the field to the top of task views in this project"),
      insert_before: z.string().optional().describe("Existing custom-field-setting GID to insert before (for ordering)"),
      insert_after: z.string().optional().describe("Existing custom-field-setting GID to insert after (for ordering)"),
    },
    withErrorHandling(async ({ project_id, ...data }) => {
      const res = await projects().addCustomFieldSettingForProject({ data }, project_id);
      return textResult(res.data);
    })
  );
}

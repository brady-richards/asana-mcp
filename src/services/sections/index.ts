import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Asana from "asana";
import { z } from "zod";
import { ServiceContext } from "../../types.js";
import { textResult } from "../../utils/formatting.js";
import { withErrorHandling } from "../../utils/errors.js";
import { limitParam, offsetParam, paginationOpts, pagedResult } from "../../utils/pagination.js";
import { assertExactlyOneOf } from "../tasks/validation.js";
import { findSectionGidByName } from "./lookup.js";

export function registerSectionsTools(
  server: McpServer,
  ctx: ServiceContext
): void {
  const sections = () => new Asana.SectionsApi(ctx.apiClient);

  server.tool(
    "asana_get_project_sections",
    "List sections in a project",
    {
      project_id: z.string().describe("Project GID"),
      limit: limitParam,
      offset: offsetParam,
    },
    withErrorHandling(async ({ project_id, limit, offset }) => {
      const res = await sections().getSectionsForProject(project_id, paginationOpts(limit, offset));
      return textResult(pagedResult(res));
    })
  );

  server.tool(
    "asana_create_section",
    "Create a new section in a project",
    {
      project_id: z.string().describe("Project GID"),
      name: z.string().describe("Section name"),
      insert_before: z.string().optional().describe("Section GID to insert before"),
      insert_after: z.string().optional().describe("Section GID to insert after"),
    },
    withErrorHandling(async ({ project_id, name, insert_before, insert_after }) => {
      const res = await sections().createSectionForProject(project_id, { body: { data: { name, insert_before, insert_after } } });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_update_section",
    "Update a section (rename)",
    {
      section_id: z.string().describe("Section GID"),
      name: z.string().describe("New section name"),
    },
    withErrorHandling(async ({ section_id, name }) => {
      const res = await sections().updateSection(section_id, { body: { data: { name } } });
      return textResult(res.data);
    })
  );

  server.tool(
    "asana_delete_section",
    "Delete a section from a project",
    {
      section_id: z.string().describe("Section GID to delete"),
    },
    withErrorHandling(async ({ section_id }) => {
      await sections().deleteSection(section_id);
      return textResult({ ok: true, deleted: section_id });
    })
  );

  server.tool(
    "asana_insert_section",
    "Reorder a section within its project by moving it before or after another section — asana_update_section only renames, it can't reposition. Identify the section to move by section_id (GID) or by name (resolved against the project's current sections).",
    {
      project_id: z.string().describe("Project GID"),
      section_id: z
        .string()
        .optional()
        .describe("GID of the section to move. Provide exactly one of section_id or name."),
      name: z
        .string()
        .optional()
        .describe(
          "Name of the section to move (matched case-insensitively against the project's current sections). Provide exactly one of section_id or name."
        ),
      before_section: z.string().optional().describe("Section GID to place it immediately before."),
      after_section: z.string().optional().describe("Section GID to place it immediately after."),
    },
    withErrorHandling(async ({ project_id, section_id, name, before_section, after_section }) => {
      assertExactlyOneOf({ section_id, name }, ["section_id", "name"]);
      if (!before_section && !after_section) {
        throw new Error("Provide at least one of 'before_section' or 'after_section'.");
      }

      let resolvedSectionId = section_id;
      if (resolvedSectionId === undefined) {
        const projectSections = await sections().getSectionsForProject(project_id, {
          opt_fields: ["name"],
        });
        resolvedSectionId = findSectionGidByName(
          (projectSections.data ?? []) as Array<{ gid: string; name?: string }>,
          name as string
        );
      }

      await sections().insertSectionForProject(project_id, {
        body: { data: { section: resolvedSectionId, before_section, after_section } },
      });
      return textResult({ ok: true, moved: resolvedSectionId });
    })
  );
}

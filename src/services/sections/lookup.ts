// Resolves a section by display name for asana_insert_section, which lets
// callers identify the section to move either by gid or by name (since a
// section's name is what's visible in the project, and gids aren't always
// on hand). `SectionsApi.insertSectionForProject` itself only accepts a gid
// (`section` in its body — see node_modules/asana/src/api/SectionsApi.js), so
// a name has to be resolved against the project's current sections first.

interface SectionLike {
  gid: string;
  name?: string;
}

/**
 * Finds the gid of the section named `name` (case-insensitive) among
 * `sections`. Throws a friendly error if none match, or if more than one
 * does (ambiguous — the caller should use section_id instead).
 */
export function findSectionGidByName(
  sections: ReadonlyArray<SectionLike>,
  name: string
): string {
  const needle = name.toLowerCase();
  const matches = sections.filter((s) => s.name?.toLowerCase() === needle);

  if (matches.length === 0) {
    throw new Error(`No section named '${name}' found in this project.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple sections named '${name}' found in this project — use section_id instead.`
    );
  }
  return matches[0].gid;
}

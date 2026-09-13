// Builds the request body for ProjectTemplatesApi.instantiateProject.
//
// The shape is unusual enough to be worth isolating (and unit-testing) away
// from the tool handler: date and role variables are addressed by the GIDs
// that `getProjectTemplate` reports in its `requested_dates` /
// `requested_roles` arrays, not by name, so a caller has to read the template
// before it can instantiate one. See Asana's instantiateProject reference.
import { z } from "zod";

/** A `requested_dates` entry: the variable's gid plus the date to bind to it. */
export const requestedDateSchema = z.object({
  gid: z
    .string()
    .describe("GID of the date variable, from the template's requested_dates array"),
  value: z.string().describe("Date to bind to it (YYYY-MM-DD)"),
});

/** A `requested_roles` entry: the role's gid plus the user filling it. */
export const requestedRoleSchema = z.object({
  gid: z
    .string()
    .describe("GID of the role, from the template's requested_roles array"),
  value: z.string().describe("User GID to assign to that role"),
});

export interface InstantiateBodyInput {
  name: string;
  team?: string;
  public?: boolean;
  requested_dates?: Array<{ gid: string; value: string }>;
  requested_roles?: Array<{ gid: string; value: string }>;
  is_organization: boolean;
}

export interface InstantiateBody {
  name: string;
  team?: string;
  public?: boolean;
  requested_dates?: Array<{ gid: string; value: string }>;
  requested_roles?: Array<{ gid: string; value: string }>;
}

/**
 * Assembles the instantiate body, applying the one rule that differs by
 * workspace kind: in an organization the new project must be placed in a
 * team, whereas outside one `public` is what decides visibility and `team`
 * is meaningless. Asana documents the divergence but reports a violation as
 * a generic 400, so this throws with the actionable message instead.
 *
 * Omits every optional key the caller didn't supply rather than sending
 * explicit undefineds — the API rejects a present-but-empty requested_dates.
 */
export function buildInstantiateBody(input: InstantiateBodyInput): InstantiateBody {
  const { name, team, requested_dates, requested_roles, is_organization } = input;

  if (is_organization && !team) {
    throw new Error(
      "This workspace is an organization, so a team GID is required to instantiate a project template."
    );
  }

  const body: InstantiateBody = { name };
  if (team) body.team = team;
  if (!is_organization && input.public !== undefined) body.public = input.public;
  if (requested_dates?.length) body.requested_dates = requested_dates;
  if (requested_roles?.length) body.requested_roles = requested_roles;
  return body;
}

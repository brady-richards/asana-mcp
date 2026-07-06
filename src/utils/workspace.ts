// Resolves "the configured workspace" for tools that let a workspace param
// default (e.g. asana_get_users_for_workspace). This server runs one process
// per workspace (--slug selects an ASANA_PAT_<SLUG> token — see src/auth.ts),
// so the single workspace visible to that token is the right default. If the
// PAT can actually see more than one workspace, there is no safe default —
// silently picking the first would route the call to an arbitrary workspace —
// so that case throws and asks for an explicit workspace_id instead.
import Asana from "asana";
import { ServiceContext } from "../types.js";

interface WorkspaceLike {
  gid: string;
  name?: string;
}

/**
 * Pure: returns the gid when exactly one workspace is visible; throws a
 * friendly error for zero (no default exists) or for more than one
 * (ambiguous — the error lists each candidate's gid and name so the caller
 * can pass workspace_id explicitly).
 */
export function pickDefaultWorkspaceGid(workspaces: readonly WorkspaceLike[]): string {
  if (workspaces.length === 0) {
    throw new Error(
      "No workspace is visible to this account's token — pass workspace_id explicitly."
    );
  }
  if (workspaces.length > 1) {
    const listing = workspaces
      .map((w) => (w.name ? `${w.gid} (${w.name})` : w.gid))
      .join(", ");
    throw new Error(
      `This account's token has access to multiple workspaces — pass workspace_id explicitly. Visible workspaces: ${listing}`
    );
  }
  return workspaces[0].gid;
}

/**
 * Resolves the default workspace gid for the account behind `ctx.apiClient`.
 * Fetches two workspaces (not one) so multi-workspace PATs are DETECTED and
 * rejected as ambiguous rather than silently truncated to the first result.
 */
export async function resolveDefaultWorkspace(ctx: ServiceContext): Promise<string> {
  const res = await new Asana.WorkspacesApi(ctx.apiClient).getWorkspaces({
    limit: 2,
    opt_fields: ["name"],
  });
  return pickDefaultWorkspaceGid((res.data ?? []) as WorkspaceLike[]);
}

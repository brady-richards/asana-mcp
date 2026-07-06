// `UsersApi.getUser` (see node_modules/asana/src/api/UsersApi.d.ts) already
// accepts "me", an email, or a gid as its one required identifier argument —
// there is no separate endpoint to route between. The one thing that DOES
// depend on which shape the identifier takes is `workspace`: an email address
// is only unambiguous within a single workspace (the same address can belong
// to different Asana users across different orgs/workspaces), so we scope the
// lookup to the account's default workspace when the identifier is an email.
// "me" and a bare gid are already unambiguous and are looked up with no
// workspace filter, exactly as before.

export type UserIdentifierKind = "me" | "email" | "gid";

/** Classifies a user identifier as accepted by `UsersApi.getUser`/`getTask`'s `assignee`, etc. */
export function classifyUserIdentifier(userId: string): UserIdentifierKind {
  if (userId === "me") return "me";
  if (userId.includes("@")) return "email";
  return "gid";
}

export interface GetUserOpts {
  workspace?: string;
  opt_fields: string[];
}

/**
 * Builds the `opts` object for `UsersApi.getUser(user_gid, opts)`. Adds
 * `workspace` only when the identifier is an email AND a workspace was
 * actually resolved (the caller only resolves one when it's needed, to avoid
 * an extra network round trip for the common gid/"me" case).
 */
export function buildGetUserOpts(
  userId: string,
  optFields: string[],
  workspace: string | undefined
): GetUserOpts {
  const kind = classifyUserIdentifier(userId);
  return kind === "email" && workspace !== undefined
    ? { workspace, opt_fields: optFields }
    : { opt_fields: optFields };
}

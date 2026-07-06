// Picks the display name Asana shows for an uploaded attachment
// (`createAttachmentForObject`'s `name` form field — see
// node_modules/asana/src/api/AttachmentsApi.d.ts) when the caller didn't
// supply one explicitly.
import path from "node:path";

export function defaultAttachmentName(opts: {
  name?: string;
  url?: string;
  local_path?: string;
}): string {
  if (opts.name) return opts.name;
  if (opts.url) return opts.url;
  if (opts.local_path) return path.basename(opts.local_path);
  throw new Error("Provide a name, or exactly one of url or local_path to derive one from.");
}

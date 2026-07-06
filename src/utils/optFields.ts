/**
 * Parses a user-supplied comma-separated `opt_fields` string (falling back to
 * a default field list when omitted), trimming whitespace around each entry
 * and dropping empty entries caused by stray/trailing commas.
 */
export function parseOptFields(input: string | undefined, defaultValue: string): string[] {
  const raw = input?.trim() ? input : defaultValue;
  return raw
    .split(",")
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

// Maps asana_create_project_status's legacy `color` param onto the
// StatusUpdate resource's `status_type`.
//
// The old ProjectStatus resource took `color` directly, but the StatusUpdate
// request schema (POST /status_updates in Asana's OpenAPI spec) REQUIRES
// `status_type` and has no `color` property at all — color is a derived,
// response-only attribute there. To keep the pre-existing minimal call shape
// (project_id, text, color) working across the backend migration, the color
// feeds this mapping when the caller doesn't pass status_type explicitly, and
// is never sent in the request body.
//
// green/yellow/red are the exact color→status semantics the Asana UI uses for
// project statuses (on track / at risk / off track).
const COLOR_TO_STATUS_TYPE: Record<string, string> = {
  green: "on_track",
  yellow: "at_risk",
  red: "off_track",
};

/**
 * Returns the explicit `status_type` when given, otherwise derives one from
 * `color` (green→on_track, yellow→at_risk, red→off_track). Throws if neither
 * yields a value — POST /status_updates requires status_type.
 */
export function resolveStatusType(
  color: string,
  statusType: string | undefined
): string {
  if (statusType !== undefined) return statusType;
  const derived = COLOR_TO_STATUS_TYPE[color];
  if (!derived) {
    throw new Error(
      `Cannot derive a status_type from color '${color}' — pass status_type explicitly.`
    );
  }
  return derived;
}

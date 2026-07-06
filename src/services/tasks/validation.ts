// Shared validation helpers for task create/update/subtask/batch-update params.
//
// Verified against Asana's public OpenAPI schema (TaskBase in
// raw.githubusercontent.com/Asana/openapi/master/defs/asana_oas.yaml): `due_at`/`due_on`
// and `start_at`/`start_on` are each documented as "should not be used together with"
// their sibling field. There is no shared `z.object()` in this codebase to hang a
// `.superRefine()` off of — every tool here registers a plain field-shape, not a
// wrapping object schema — so cross-field checks run as an explicit call inside each
// tool's handler, after Zod's own per-field validation has already run.
import { z } from "zod";

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const DATETIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const DATE_MESSAGE = "must be an ISO 8601 date in YYYY-MM-DD format (e.g. 2026-01-15)";
const DATETIME_MESSAGE =
  "must be an ISO 8601 datetime in UTC (e.g. 2026-01-15T09:00:00Z)";

/** A YYYY-MM-DD date string, for create-time (non-clearable) params. */
export function dateField() {
  return z.string().regex(DATE_REGEX, DATE_MESSAGE);
}

/** An ISO 8601 datetime string, for create-time (non-clearable) params. */
export function datetimeField() {
  return z.string().regex(DATETIME_REGEX, DATETIME_MESSAGE);
}

/**
 * A clearable date field for update calls. Accepts a valid YYYY-MM-DD string,
 * a JSON `null`, or the literal string `"null"` (some MCP clients can only
 * send string-typed tool arguments) — pair with `clearNullSentinel` when
 * building the request body to fold `"null"` into a real `null`.
 */
export function nullableDateField() {
  return z.union([dateField(), z.literal("null"), z.null()]).optional();
}

/** As `nullableDateField`, but for ISO 8601 datetime values. */
export function nullableDatetimeField() {
  return z.union([datetimeField(), z.literal("null"), z.null()]).optional();
}

/**
 * Folds the `"null"` string sentinel produced by `nullableDateField` /
 * `nullableDatetimeField` into a real `null` (which the Asana API treats as
 * "clear this field"). A real `null`, a valid date string, or `undefined`
 * all pass through unchanged.
 */
export function clearNullSentinel(
  value: string | null | undefined
): string | null | undefined {
  return value === "null" ? null : value;
}

/**
 * Throws a friendly `Error` naming both parameters if a mutually-exclusive
 * pair both hold a real (string) value. A `null` (clearing) or `undefined`
 * (untouched) value never conflicts with its sibling — only two live string
 * values do.
 *
 * NOTE: this low-level check treats ANY string as live — including the
 * `"null"` clearing sentinel accepted by `nullableDateField` /
 * `nullableDatetimeField`. Callers handling clearable fields must normalize
 * via `clearNullSentinel` BEFORE asserting (use
 * `normalizeAndValidateDateFields`, which does both in the right order).
 */
export function assertMutuallyExclusive(
  fields: Record<string, unknown>,
  pairs: ReadonlyArray<readonly [string, string]>
): void {
  for (const [a, b] of pairs) {
    if (typeof fields[a] === "string" && typeof fields[b] === "string") {
      throw new Error(
        `Provide only one of '${a}' or '${b}' — they are mutually exclusive and cannot both be set.`
      );
    }
  }
}

/** The four clearable scheduling fields shared by update-style task calls. */
export interface DateFields {
  due_on?: string | null;
  due_at?: string | null;
  start_on?: string | null;
  start_at?: string | null;
}

const DATE_FIELD_KEYS = ["due_on", "due_at", "start_on", "start_at"] as const;

const DATE_SIBLING_PAIRS = [
  ["due_on", "due_at"],
  ["start_on", "start_at"],
] as const;

/**
 * Folds each date field's `"null"` sentinel into a real `null`, then enforces
 * due_on/due_at and start_on/start_at mutual exclusivity on the NORMALIZED
 * values. Ordering matters: normalizing first means clearing one sibling
 * (with `null` or `"null"`) while setting the other — e.g. switching a task
 * from date to datetime scheduling in one call — passes validation, whereas
 * asserting on raw values would see the `"null"` string as a live value and
 * throw a spurious exclusivity error. Returns only the fields that were
 * provided (`undefined` entries are omitted), ready to spread into a request
 * body without touching unspecified fields.
 */
export function normalizeAndValidateDateFields(fields: DateFields): DateFields {
  const normalized: DateFields = {};
  for (const key of DATE_FIELD_KEYS) {
    const value = fields[key];
    if (value !== undefined) normalized[key] = clearNullSentinel(value);
  }
  assertMutuallyExclusive({ ...normalized }, DATE_SIBLING_PAIRS);
  return normalized;
}

/**
 * Throws a friendly `Error` naming all candidates unless exactly one of
 * `keys` is present (non-`undefined`) on `fields`.
 */
export function assertExactlyOneOf(
  fields: Record<string, unknown>,
  keys: readonly string[]
): void {
  const present = keys.filter((k) => fields[k] !== undefined);
  if (present.length !== 1) {
    throw new Error(
      `Provide exactly one of ${keys.map((k) => `'${k}'`).join(" or ")} (got ${present.length}).`
    );
  }
}

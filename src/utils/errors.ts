// Error unwrapping + retry for the Asana SDK (superagent-based).
//
// On a non-2xx response, superagent rejects with an `Error` that has `.status`
// (HTTP status code) and `.response` (the superagent Response, with `.body`
// the parsed JSON and `.headers` the lowercased response headers). Asana's API
// error bodies look like `{ errors: [{ message, help }] }`. This mirrors the
// pattern already used in scripts/convert-to-milestones.mjs:
//   e?.response?.body?.errors?.[0]?.message || e.message

interface AsanaApiErrorLike {
  status?: number;
  message?: string;
  response?: {
    status?: number;
    headers?: Record<string, string | string[] | undefined>;
    body?: {
      errors?: Array<{ message?: string }>;
    };
  };
}

const PREMIUM_FEATURE_MESSAGE =
  "This is a premium Asana feature — not available in this workspace (free tier); for task search fall back to asana_get_tasks_for_project.";

const MAX_RETRY_AFTER_SECONDS = 15;
const DEFAULT_RETRY_AFTER_SECONDS = 1;

function fieldMessages(e: AsanaApiErrorLike): string | undefined {
  const errors = e.response?.body?.errors;
  if (!errors || errors.length === 0) return undefined;
  const messages = errors.map((err) => err.message).filter((m): m is string => Boolean(m));
  return messages.length > 0 ? messages.join("; ") : undefined;
}

/**
 * Unwraps an Asana SDK error into a status code (if any) and a clean,
 * human-readable message — applying special-cased wording for 402 (premium
 * feature gate) and passing through field-level messages verbatim for 400s
 * and other API errors.
 */
export function extractAsanaError(e: unknown): { status?: number; message: string } {
  const err = (e ?? {}) as AsanaApiErrorLike;
  const status = err.status ?? err.response?.status;
  const apiMessage = fieldMessages(err);

  if (status === 402) {
    return { status, message: PREMIUM_FEATURE_MESSAGE };
  }

  const message = apiMessage ?? err.message ?? String(e);
  return { status, message };
}

/**
 * Reads the `Retry-After` header (seconds) off an error's response, capped at
 * `MAX_RETRY_AFTER_SECONDS`. Falls back to `DEFAULT_RETRY_AFTER_SECONDS` when
 * the header is missing or unparsable.
 */
export function getRetryAfterSeconds(e: unknown, capSeconds = MAX_RETRY_AFTER_SECONDS): number {
  const err = (e ?? {}) as AsanaApiErrorLike;
  const headers = err.response?.headers ?? {};
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  const rawValue = Array.isArray(raw) ? raw[0] : raw;
  const parsed = rawValue !== undefined ? Number(rawValue) : NaN;
  const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(seconds, capSeconds);
}

function isRateLimited(e: unknown): boolean {
  const err = (e ?? {}) as AsanaApiErrorLike;
  return (err.status ?? err.response?.status) === 429;
}

export interface WithErrorHandlingOptions {
  /** Injectable for tests; defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps an async tool handler so that:
 *  - A 429 triggers exactly one retry, after sleeping for `Retry-After`
 *    seconds (capped at 15s).
 *  - Any other failure (or a repeated 429) is rethrown as a plain `Error`
 *    whose message is the unwrapped Asana error message (see
 *    `extractAsanaError`), so the MCP SDK's own tool-call error handling
 *    surfaces a clean message instead of a raw superagent error dump.
 */
export function withErrorHandling<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  options: WithErrorHandlingOptions = {}
): (...args: Args) => Promise<R> {
  const sleep = options.sleep ?? defaultSleep;

  return async (...args: Args): Promise<R> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (isRateLimited(e)) {
        await sleep(getRetryAfterSeconds(e) * 1000);
        try {
          return await fn(...args);
        } catch (retryError) {
          throw new Error(extractAsanaError(retryError).message);
        }
      }
      throw new Error(extractAsanaError(e).message);
    }
  };
}

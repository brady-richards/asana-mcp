// Helpers for Asana's sync-token handshake on `EventsApi.getEvents` (see
// node_modules/asana/src/api/EventsApi.d.ts): "On your first request, omit the
// sync token. The response will be the same as for an expired sync token, and
// will include a new valid sync token. If the sync token is too old ... the
// API will return a 412 Precondition Failed error, and include a fresh sync
// token in the response." That fresh token rides along in the error response
// body's `sync` field, alongside the usual `errors` array.
//
// Same superagent-shaped error as src/utils/errors.ts's AsanaApiErrorLike.
interface AsanaApiErrorLike {
  status?: number;
  response?: {
    status?: number;
    body?: {
      sync?: string;
      errors?: Array<{ message?: string }>;
    };
  };
}

/** True for a 412 Precondition Failed — Asana's "your sync token is missing/expired" signal. */
export function isPreconditionFailed(e: unknown): boolean {
  const err = (e ?? {}) as AsanaApiErrorLike;
  return (err.status ?? err.response?.status) === 412;
}

/** Extracts the fresh sync token Asana includes in a 412 response body, if present. */
export function extractSyncToken(e: unknown): string | undefined {
  const err = (e ?? {}) as AsanaApiErrorLike;
  return err.response?.body?.sync;
}

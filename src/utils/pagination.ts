// Zod schema fragments shared by every paginated list tool.
import { z } from "zod";

/** Default page size when the caller doesn't specify `limit`. */
export const DEFAULT_PAGE_LIMIT = 50;
/** Asana's documented max page size for list endpoints. */
export const MAX_PAGE_LIMIT = 100;

export const limitParam = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_LIMIT)
  .optional()
  .describe(`Results per page (1-${MAX_PAGE_LIMIT}, default ${DEFAULT_PAGE_LIMIT})`);

export const offsetParam = z
  .string()
  .optional()
  .describe("Pagination offset token from a previous response's next_page.offset");

/**
 * Builds the `{ limit, offset }` opts to pass to an SDK list call, applying
 * the default page size and omitting `offset` entirely when not provided
 * (the Asana API rejects/ignores a present-but-empty offset).
 */
export function paginationOpts(
  limit: number | undefined,
  offset: string | undefined
): { limit: number; offset?: string } {
  return {
    limit: limit ?? DEFAULT_PAGE_LIMIT,
    ...(offset ? { offset } : {}),
  };
}

interface SdkCollectionLike<T> {
  data?: T[];
  _response?: {
    next_page?: { offset?: string } | null;
  };
}

export interface PagedPayload<T> {
  data: T[];
  next_page: { offset: string } | null;
}

/**
 * Shapes an SDK list response (a `Collection` — see node_modules/asana/src/utils/collection.js,
 * which exposes `.data` for the resource array and `._response` for the raw
 * deserialized body, e.g. `{ data: [...], next_page: { offset, path, uri } }`)
 * into a stable `{ data, next_page }` tool payload.
 */
export function pagedResult<T>(collection: SdkCollectionLike<T>): PagedPayload<T> {
  const next = collection._response?.next_page;
  return {
    data: collection.data ?? [],
    next_page: next?.offset ? { offset: next.offset } : null,
  };
}

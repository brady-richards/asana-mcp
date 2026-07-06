import { describe, it, expect } from "vitest";
import { isPreconditionFailed, extractSyncToken } from "../../../src/services/events/sync.js";

function syncTokenError(opts: {
  status?: number;
  body?: unknown;
}): Error & { status?: number; response?: unknown } {
  const err = new Error("Sync token invalid or too old") as Error & {
    status?: number;
    response?: unknown;
  };
  err.status = opts.status;
  err.response = { status: opts.status, body: opts.body };
  return err;
}

describe("isPreconditionFailed", () => {
  it("is true for a 412 error", () => {
    expect(isPreconditionFailed(syncTokenError({ status: 412 }))).toBe(true);
  });

  it("is false for other status codes", () => {
    expect(isPreconditionFailed(syncTokenError({ status: 400 }))).toBe(false);
    expect(isPreconditionFailed(syncTokenError({ status: 500 }))).toBe(false);
  });

  it("is false when there is no status at all", () => {
    expect(isPreconditionFailed(new Error("boom"))).toBe(false);
    expect(isPreconditionFailed(undefined)).toBe(false);
    expect(isPreconditionFailed(null)).toBe(false);
  });

  it("reads status off e.response.status when e.status is absent", () => {
    const err = new Error("x") as Error & { response?: unknown };
    err.response = { status: 412 };
    expect(isPreconditionFailed(err)).toBe(true);
  });
});

describe("extractSyncToken", () => {
  it("reads the fresh sync token from the 412 response body", () => {
    const err = syncTokenError({
      status: 412,
      body: { errors: [{ message: "Sync token invalid or too old" }], sync: "abc123" },
    });
    expect(extractSyncToken(err)).toBe("abc123");
  });

  it("returns undefined when the body has no sync field", () => {
    const err = syncTokenError({ status: 412, body: { errors: [{ message: "x" }] } });
    expect(extractSyncToken(err)).toBeUndefined();
  });

  it("returns undefined when there is no response body at all", () => {
    expect(extractSyncToken(new Error("boom"))).toBeUndefined();
    expect(extractSyncToken(undefined)).toBeUndefined();
  });
});

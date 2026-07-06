import { describe, it, expect, vi } from "vitest";
import { extractAsanaError, withErrorHandling } from "../../src/utils/errors.js";

function superagentError(opts: {
  status?: number;
  message?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Error & { status?: number; response?: unknown } {
  const err = new Error(opts.message ?? "Unsuccessful HTTP response") as Error & {
    status?: number;
    response?: unknown;
  };
  err.status = opts.status;
  err.response = {
    status: opts.status,
    body: opts.body,
    headers: opts.headers ?? {},
  };
  return err;
}

describe("extractAsanaError", () => {
  it("extracts status and field-level message from a 400 response", () => {
    const err = superagentError({
      status: 400,
      body: { errors: [{ message: "due_on: Not a valid date" }] },
    });
    const result = extractAsanaError(err);
    expect(result.status).toBe(400);
    expect(result.message).toContain("due_on: Not a valid date");
  });

  it("maps a 402 to a premium-feature message with a fallback suggestion", () => {
    const err = superagentError({
      status: 402,
      body: { errors: [{ message: "This feature requires premium" }] },
    });
    const result = extractAsanaError(err);
    expect(result.status).toBe(402);
    expect(result.message).toMatch(/premium/i);
    expect(result.message).toMatch(/free tier/i);
    expect(result.message).toContain("asana_get_tasks_for_project");
  });

  it("falls back to e.message when there is no response body", () => {
    const err = new Error("socket hang up") as Error & { status?: number };
    const result = extractAsanaError(err);
    expect(result.message).toBe("socket hang up");
    expect(result.status).toBeUndefined();
  });

  it("falls back to e.message when the response body has no errors array", () => {
    const err = superagentError({ status: 500, body: {} });
    const result = extractAsanaError(err);
    expect(result.status).toBe(500);
    expect(result.message).toBe("Unsuccessful HTTP response");
  });

  it("joins multiple error messages from the body", () => {
    const err = superagentError({
      status: 400,
      body: { errors: [{ message: "name: too short" }, { message: "workspace: required" }] },
    });
    const result = extractAsanaError(err);
    expect(result.message).toContain("name: too short");
    expect(result.message).toContain("workspace: required");
  });
});

describe("withErrorHandling", () => {
  it("passes through a successful call untouched", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const wrapped = withErrorHandling(fn);
    await expect(wrapped("a", "b")).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledWith("a", "b");
  });

  it("rethrows a clean Error with the unwrapped message on non-retryable failure", async () => {
    const err = superagentError({
      status: 400,
      body: { errors: [{ message: "name: is required" }] },
    });
    const fn = vi.fn().mockRejectedValue(err);
    const wrapped = withErrorHandling(fn);
    await expect(wrapped()).rejects.toThrow(/name: is required/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("on 429, sleeps for the Retry-After duration (capped at 15s) and retries once", async () => {
    const rateLimited = superagentError({
      status: 429,
      body: { errors: [{ message: "Rate limit exceeded" }] },
      headers: { "retry-after": "3" },
    });
    const fn = vi.fn().mockRejectedValueOnce(rateLimited).mockResolvedValueOnce("recovered");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandling(fn, { sleep });

    await expect(wrapped()).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("caps the 429 retry sleep at 15 seconds even if Retry-After is larger", async () => {
    const rateLimited = superagentError({
      status: 429,
      body: { errors: [{ message: "Rate limit exceeded" }] },
      headers: { "retry-after": "120" },
    });
    const fn = vi.fn().mockRejectedValueOnce(rateLimited).mockResolvedValueOnce("recovered");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandling(fn, { sleep });

    await expect(wrapped()).resolves.toBe("recovered");
    expect(sleep).toHaveBeenCalledWith(15000);
  });

  it("throws after a single retry if the 429 retry also fails", async () => {
    const rateLimited = superagentError({
      status: 429,
      body: { errors: [{ message: "Rate limit exceeded" }] },
      headers: { "retry-after": "1" },
    });
    const stillFailing = superagentError({
      status: 429,
      body: { errors: [{ message: "Rate limit exceeded again" }] },
      headers: { "retry-after": "1" },
    });
    const fn = vi.fn().mockRejectedValueOnce(rateLimited).mockRejectedValueOnce(stillFailing);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandling(fn, { sleep });

    await expect(wrapped()).rejects.toThrow(/Rate limit exceeded again/);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("rewrites a 402 into the premium-feature guidance message", async () => {
    const err = superagentError({
      status: 402,
      body: { errors: [{ message: "Premium feature" }] },
    });
    const fn = vi.fn().mockRejectedValue(err);
    const wrapped = withErrorHandling(fn);
    await expect(wrapped()).rejects.toThrow(/asana_get_tasks_for_project/);
  });
});

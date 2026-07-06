import { describe, it, expect, vi } from "vitest";
import {
  isJobTerminal,
  pollJob,
  startAndPollJob,
  JobLike,
} from "../../../src/services/tasks/jobs.js";

describe("isJobTerminal", () => {
  it("treats succeeded and failed as terminal", () => {
    expect(isJobTerminal({ gid: "1", status: "succeeded" })).toBe(true);
    expect(isJobTerminal({ gid: "1", status: "failed" })).toBe(true);
  });

  it("treats not_started and in_progress as non-terminal", () => {
    expect(isJobTerminal({ gid: "1", status: "not_started" })).toBe(false);
    expect(isJobTerminal({ gid: "1", status: "in_progress" })).toBe(false);
  });

  it("treats a missing status as non-terminal", () => {
    expect(isJobTerminal({ gid: "1" })).toBe(false);
  });
});

describe("pollJob", () => {
  // A controllable fake clock: `now()` reads the counter, `sleep(ms)` advances
  // it by `ms` instead of actually waiting — keeps the whole test suite fast
  // and deterministic while still exercising the real backoff/timeout math.
  function fakeClock(start = 0) {
    let time = start;
    return {
      now: () => time,
      sleep: vi.fn(async (ms: number) => {
        time += ms;
      }),
    };
  }

  it("returns immediately, with no sleep, when the job is already terminal", async () => {
    const clock = fakeClock();
    const getJob = vi.fn().mockResolvedValue({ gid: "j1", status: "succeeded" } as JobLike);

    const result = await pollJob(getJob, { now: clock.now, sleep: clock.sleep });

    expect(result).toEqual({ job: { gid: "j1", status: "succeeded" }, timedOut: false });
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it("polls again after sleeping when the job is still in progress, then returns once terminal", async () => {
    const clock = fakeClock();
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ gid: "j1", status: "in_progress" } as JobLike)
      .mockResolvedValueOnce({ gid: "j1", status: "in_progress" } as JobLike)
      .mockResolvedValueOnce({ gid: "j1", status: "succeeded" } as JobLike);

    const result = await pollJob(getJob, { now: clock.now, sleep: clock.sleep });

    expect(result).toEqual({ job: { gid: "j1", status: "succeeded" }, timedOut: false });
    expect(getJob).toHaveBeenCalledTimes(3);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
  });

  it("treats a failed job as terminal (caller decides how to report it)", async () => {
    const clock = fakeClock();
    const getJob = vi.fn().mockResolvedValue({ gid: "j1", status: "failed" } as JobLike);

    const result = await pollJob(getJob, { now: clock.now, sleep: clock.sleep });

    expect(result).toEqual({ job: { gid: "j1", status: "failed" }, timedOut: false });
  });

  it("backs off with growing delays, capped at maxDelayMs", async () => {
    const clock = fakeClock();
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ gid: "j1", status: "in_progress" } as JobLike)
      .mockResolvedValueOnce({ gid: "j1", status: "in_progress" } as JobLike)
      .mockResolvedValueOnce({ gid: "j1", status: "in_progress" } as JobLike)
      .mockResolvedValueOnce({ gid: "j1", status: "succeeded" } as JobLike);

    await pollJob(getJob, {
      now: clock.now,
      sleep: clock.sleep,
      initialDelayMs: 500,
      maxDelayMs: 1500,
      timeoutMs: 60_000,
    });

    expect(clock.sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000, 1500]);
  });

  it("stops polling and reports timedOut once the deadline elapses, without throwing", async () => {
    const clock = fakeClock();
    const getJob = vi.fn().mockResolvedValue({ gid: "j1", status: "in_progress" } as JobLike);

    const result = await pollJob(getJob, {
      now: clock.now,
      sleep: clock.sleep,
      initialDelayMs: 1000,
      maxDelayMs: 1000,
      timeoutMs: 3000,
    });

    expect(result.timedOut).toBe(true);
    expect(result.job).toEqual({ gid: "j1", status: "in_progress" });
    // Never throws — the job keeps running server-side; caller reports "still running".
  });

  it("never sleeps past the deadline (clamps the final wait to the remaining budget)", async () => {
    const clock = fakeClock();
    const getJob = vi.fn().mockResolvedValue({ gid: "j1", status: "in_progress" } as JobLike);

    await pollJob(getJob, {
      now: clock.now,
      sleep: clock.sleep,
      initialDelayMs: 5000,
      maxDelayMs: 5000,
      timeoutMs: 3000,
    });

    // Only one sleep call happens, clamped to the 3000ms budget rather than the 5000ms delay.
    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(clock.sleep).toHaveBeenCalledWith(3000);
  });

  it("uses a real setTimeout-based sleep and Date.now by default", async () => {
    const getJob = vi.fn().mockResolvedValue({ gid: "j1", status: "succeeded" } as JobLike);
    const result = await pollJob(getJob);
    expect(result).toEqual({ job: { gid: "j1", status: "succeeded" }, timedOut: false });
  });
});

describe("startAndPollJob", () => {
  function fakeClock(start = 0) {
    let time = start;
    return {
      now: () => time,
      sleep: vi.fn(async (ms: number) => {
        time += ms;
      }),
    };
  }

  it("calls start exactly once and returns the terminal job when polling succeeds", async () => {
    const clock = fakeClock();
    const start = vi.fn().mockResolvedValue({ gid: "j1", status: "in_progress" } as JobLike);
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ gid: "j1", status: "in_progress" } as JobLike)
      .mockResolvedValueOnce({ gid: "j1", status: "succeeded" } as JobLike);

    const result = await startAndPollJob(start, getJob, { now: clock.now, sleep: clock.sleep });

    expect(result).toEqual({ job: { gid: "j1", status: "succeeded" }, timedOut: false });
    expect(start).toHaveBeenCalledTimes(1);
    expect(getJob).toHaveBeenCalledWith("j1");
  });

  it("does NOT throw and does NOT re-run start when polling rejects — falls back to the started job's gid", async () => {
    // This is the whole point of the composition: the tool handler is wrapped
    // in withErrorHandling, whose 429 handling re-invokes the ENTIRE handler.
    // If a polling error escaped, the retry would call the mutation (start)
    // again and create a second duplicate. Swallowing polling errors here
    // guarantees the mutation runs exactly once per tool call.
    const clock = fakeClock();
    const start = vi.fn().mockResolvedValue({ gid: "j1", status: "in_progress" } as JobLike);
    const getJob = vi.fn().mockRejectedValue(new Error("Rate limit exceeded"));

    const result = await startAndPollJob(start, getJob, { now: clock.now, sleep: clock.sleep });

    expect(start).toHaveBeenCalledTimes(1);
    expect(result.job.gid).toBe("j1");
    expect(result.timedOut).toBe(true);
    expect(result.pollError).toMatch(/Rate limit exceeded/);
  });

  it("swallows a polling error on a later poll too, still reporting the job gid", async () => {
    const clock = fakeClock();
    const start = vi.fn().mockResolvedValue({ gid: "j1", status: "in_progress" } as JobLike);
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({ gid: "j1", status: "in_progress" } as JobLike)
      .mockRejectedValueOnce(new Error("socket hang up"));

    const result = await startAndPollJob(start, getJob, { now: clock.now, sleep: clock.sleep });

    expect(start).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      job: { gid: "j1", status: "in_progress" },
      timedOut: true,
      pollError: "socket hang up",
    });
  });

  it("propagates an error from start itself (the mutation was rejected pre-execution, so a retry is safe)", async () => {
    const clock = fakeClock();
    const start = vi.fn().mockRejectedValue(new Error("Rate limit exceeded"));
    const getJob = vi.fn();

    await expect(
      startAndPollJob(start, getJob, { now: clock.now, sleep: clock.sleep })
    ).rejects.toThrow(/Rate limit exceeded/);
    expect(getJob).not.toHaveBeenCalled();
  });

  it("reports a plain timeout (no pollError) when the job just never finishes in time", async () => {
    const clock = fakeClock();
    const start = vi.fn().mockResolvedValue({ gid: "j1", status: "in_progress" } as JobLike);
    const getJob = vi.fn().mockResolvedValue({ gid: "j1", status: "in_progress" } as JobLike);

    const result = await startAndPollJob(start, getJob, {
      now: clock.now,
      sleep: clock.sleep,
      initialDelayMs: 1000,
      maxDelayMs: 1000,
      timeoutMs: 2000,
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(result.timedOut).toBe(true);
    expect(result.pollError).toBeUndefined();
    expect(result.job).toEqual({ gid: "j1", status: "in_progress" });
  });
});

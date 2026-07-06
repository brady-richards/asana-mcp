// Polling helper for Asana's async Job resource (JobsApi.getJob — see
// node_modules/asana/src/api/JobsApi.d.ts). `TasksApi.duplicateTask` (and other
// async endpoints) return a Job immediately and finish the actual work in the
// background; the caller has to poll `GET /jobs/{job_gid}` until the job's
// `status` reaches a terminal value.
//
// Job.status is documented as one of "not_started", "in_progress", "succeeded",
// or "failed" (the SDK's generated types don't model the Job resource's fields
// at all — `getJob` returns `any` — so this is taken from Asana's public API
// reference for the Job resource, not invented).

/** The subset of a Job resource this module cares about. */
export interface JobLike {
  gid: string;
  status?: string;
  [key: string]: unknown;
}

/** True once a job has reached a terminal state (succeeded or failed). */
export function isJobTerminal(job: JobLike): boolean {
  return job.status === "succeeded" || job.status === "failed";
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface PollJobOptions {
  /** Total time budget, in ms, before giving up and reporting "still running". Default 30000 (~30s). */
  timeoutMs?: number;
  /** Delay before the first re-check, in ms. Default 500. */
  initialDelayMs?: number;
  /** Cap on the per-check delay, in ms (backoff doubles up to this). Default 5000. */
  maxDelayMs?: number;
  /** Injectable sleep, for tests. Defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (ms since epoch), for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface PollJobResult {
  /** The last-seen job record. */
  job: JobLike;
  /** True if `timeoutMs` elapsed before the job reached a terminal state. */
  timedOut: boolean;
}

/**
 * Polls `getJob` with doubling backoff (capped at `maxDelayMs`) until the job
 * reaches a terminal state (`succeeded`/`failed`) or `timeoutMs` elapses.
 *
 * Never throws on a timeout: the job keeps running server-side regardless of
 * whether we're still watching it, so giving up on our end just means
 * returning the last-seen job with `timedOut: true` — the caller reports it
 * as "still running" (with the job gid to check later) rather than failing
 * the tool call outright.
 */
export async function pollJob(
  getJob: () => Promise<JobLike>,
  options: PollJobOptions = {}
): Promise<PollJobResult> {
  const {
    timeoutMs = 30_000,
    initialDelayMs = 500,
    maxDelayMs = 5_000,
    sleep = defaultSleep,
    now = Date.now,
  } = options;

  const deadline = now() + timeoutMs;
  let delay = initialDelayMs;
  let job = await getJob();

  while (!isJobTerminal(job)) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(delay, maxDelayMs, remaining));
    delay = Math.min(delay * 2, maxDelayMs);
    job = await getJob();
  }

  return { job, timedOut: !isJobTerminal(job) };
}

export interface StartAndPollJobResult extends PollJobResult {
  /**
   * Set when polling itself failed (rate limit, network, 5xx) after the job
   * had already been started. The job keeps running server-side; `job` is the
   * last-known record (at minimum the started job with its gid) and
   * `timedOut` is true so callers report "still running" rather than failing.
   */
  pollError?: string;
}

/**
 * Runs a job-backed mutation end-to-end: calls `start` (the mutation — e.g.
 * `TasksApi.duplicateTask`) exactly once, then polls `getJob` until the job
 * is terminal or the time budget runs out.
 *
 * The split in error behavior is deliberate and load-bearing:
 *  - An error from `start` PROPAGATES. The mutation was rejected before it
 *    executed, so the caller's withErrorHandling wrapper may safely retry the
 *    whole handler (its 429 handling re-invokes the entire wrapped function).
 *  - An error while POLLING is swallowed into `pollError`. At that point the
 *    mutation has already been accepted and the job is running server-side —
 *    letting the error escape would make withErrorHandling re-invoke the
 *    handler and run the mutation AGAIN (e.g. a second duplicate task), and
 *    any non-429 rethrow would orphan the job gid the caller needs in order
 *    to check on it later.
 */
export async function startAndPollJob(
  start: () => Promise<JobLike>,
  getJob: (jobGid: string) => Promise<JobLike>,
  options: PollJobOptions = {}
): Promise<StartAndPollJobResult> {
  const startedJob = await start();
  try {
    return await pollJob(() => getJob(startedJob.gid), options);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { job: startedJob, timedOut: true, pollError: message };
  }
}

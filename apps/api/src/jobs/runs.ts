import { JOB_RUNS_KEPT_DAYS, type JobName } from "@finance-app/shared";
import { eq, lt } from "drizzle-orm";
import { jobRuns } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";

/**
 * What ran, when, and whether it worked.
 *
 * Pip is allowed to sleep, so nothing pings the API to prove it's alive.
 * Instead every job writes here — a row when it starts, the same row again
 * when it finishes or fails — and a check inside Supabase reads these rows and
 * emails the owner when work has gone stale, failed, or never happened at all. A
 * job that dies mid-run leaves an unfinished row, which reads as a failure.
 */

export interface JobRun {
  /** Records the end of the run. Errors make it a failure. */
  finish(summary?: Record<string, unknown>, errorSteps?: string[]): Promise<void>;
}

export interface JobRecorder {
  start(job: JobName, at: Date): Promise<JobRun>;
  /** Drops runs older than `JOB_RUNS_KEPT_DAYS`. */
  cleanUp(at: Date): Promise<number>;
}

export function dbJobRecorder(db: Db): JobRecorder {
  return {
    async start(job, at) {
      const [row] = await db
        .insert(jobRuns)
        .values({ job, startedAt: at })
        .returning({ id: jobRuns.id });
      const id = row!.id;
      return {
        async finish(summary = {}, errorSteps = []) {
          await db
            .update(jobRuns)
            .set({ finishedAt: new Date(), summary, errorSteps })
            .where(eq(jobRuns.id, id));
        },
      };
    },

    async cleanUp(at) {
      const cutoff = new Date(at.getTime() - JOB_RUNS_KEPT_DAYS * 86_400_000);
      const gone = await db
        .delete(jobRuns)
        .where(lt(jobRuns.startedAt, cutoff))
        .returning({ id: jobRuns.id });
      return gone.length;
    },
  };
}

/** Records nothing: stub mode, and tests that aren't about the recording. */
export function noJobRecorder(): JobRecorder {
  return {
    async start() {
      return { async finish() {} };
    },
    async cleanUp() {
      return 0;
    },
  };
}

import { STALE_REFRESH_MINUTES, type JobName } from "@finance-app/shared";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { jobRuns } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";

/**
 * What Pip has been doing.
 *
 * `/status` is for Setup's one line — "Pip last checked prices and news 12 min
 * ago" — and says nothing about why anything failed. `/health/jobs` is a plain
 * up-or-down for the owner to open in a browser; **nothing calls either on a
 * schedule**, because Pip is allowed to sleep and a scheduled check would keep
 * it awake. The real watching is done inside the database.
 */

export interface JobStatus {
  /** The last run that finished, whether it worked or not. */
  lastRunAt: Date | null;
  lastGoodAt: Date | null;
  failing: boolean;
}

export interface JobStatusReader {
  lastRun(job: JobName): Promise<JobStatus>;
}

export function dbJobStatus(db: Db): JobStatusReader {
  return {
    async lastRun(job) {
      const rows = await db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.job, job))
        .orderBy(desc(jobRuns.startedAt))
        .limit(20);
      const finished = rows.filter((row) => row.finishedAt !== null);
      const last = finished[0];
      const lastGood = finished.find((row) => row.errorSteps.length === 0);
      return {
        lastRunAt: last?.finishedAt ?? null,
        lastGoodAt: lastGood?.finishedAt ?? null,
        failing: last !== undefined && last.errorSteps.length > 0,
      };
    },
  };
}

/** Stub mode: always just-run, so the line on Setup says something sensible. */
export function fixedJobStatus(at: () => Date = () => new Date()): JobStatusReader {
  return {
    async lastRun() {
      return { lastRunAt: at(), lastGoodAt: at(), failing: false };
    },
  };
}

const staleAfterMs = STALE_REFRESH_MINUTES * 60_000;

export function registerStatusRoutes(
  app: FastifyInstance,
  options: { jobs: JobStatusReader; now?: () => Date },
): void {
  const now = options.now ?? (() => new Date());

  /** Behind the guard like every other route: it's about this person's Pip. */
  app.get("/status", async () => {
    const prices = await options.jobs.lastRun("prices");
    const at = prices.lastGoodAt;
    return {
      ...(at ? { lastCheckedAt: at.toISOString() } : {}),
      // Old enough that Setup says so plainly. Why is not the screen's business.
      stale: at === null || now().getTime() - at.getTime() > staleAfterMs,
    };
  });

  /**
   * Up or down, no detail, for the owner to open by hand. It answers without a
   * session because it says nothing — and because a browser tab is the point.
   */
  app.get("/health/jobs", async (_request, reply) => {
    const prices = await options.jobs.lastRun("prices");
    const at = prices.lastGoodAt;
    const stale = at === null || now().getTime() - at.getTime() > staleAfterMs;
    return reply.status(stale || prices.failing ? 503 : 200).send({
      status: stale || prices.failing ? "stale" : "ok",
    });
  });
}

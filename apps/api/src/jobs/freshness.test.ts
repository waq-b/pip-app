import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobRuns } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { testDatabase } from "../test-support/pglite.js";

/**
 * The ops check that never wakes Pip (phase-6.md decision 7). `private.stale_jobs`
 * is the whole judgement — what the emailer sends is just these rows — so it's
 * tested here on a real Postgres, against the real migration.
 *
 * Pip is allowed to sleep: outside the hours it's meant to run, silence is not
 * a failure, and that's the thing most likely to go wrong in a checker like
 * this one.
 */

let db: Db;
let close: () => Promise<void>;

/** Mondays are the interesting day, so the clock sits there unless a test moves it. */
const MONDAY_10AM = new Date("2026-09-14T09:00:00Z");

const stale = async (at: Date) => {
  const result = await db.execute(
    sql`select job, reason from private.stale_jobs(${at.toISOString()}::timestamptz)`,
  );
  return (result as { rows: { job: string; reason: string }[] }).rows;
};

async function ran(job: string, finishedAt: Date | null, errorSteps: string[] = []) {
  await db.insert(jobRuns).values({
    job,
    startedAt: new Date((finishedAt ?? MONDAY_10AM).getTime() - 60_000),
    finishedAt,
    errorSteps,
  });
}

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
  await db.execute(
    sql`insert into private.job_settings (id, refresh_url, job_secret) values (true, 'https://pip.example.com/api/jobs/refresh', 'x')`,
  );
});
afterAll(async () => close());

beforeEach(async () => {
  await db.delete(jobRuns);
});

describe("what the freshness check calls stale", () => {
  it("says nothing when every job has just run cleanly", async () => {
    await ran("prices", new Date("2026-09-14T08:50:00Z"));
    await ran("weekly_build", new Date("2026-09-14T07:05:00Z"));
    expect(await stale(MONDAY_10AM)).toEqual([]);
  });

  it("names prices when the last good refresh is older than the threshold", async () => {
    await ran("prices", new Date("2026-09-14T07:30:00Z"));
    await ran("weekly_build", new Date("2026-09-14T07:05:00Z"));

    const problems = await stale(MONDAY_10AM);
    expect(problems.map((p) => p.job)).toEqual(["prices"]);
    expect(problems[0]!.reason).toContain("75 minutes");
  });

  it("doesn't count a refresh that failed as a refresh", async () => {
    await ran("prices", new Date("2026-09-14T08:50:00Z"), ["prices"]);
    await ran("weekly_build", new Date("2026-09-14T07:05:00Z"));
    expect((await stale(MONDAY_10AM)).map((p) => p.job)).toEqual(["prices"]);
  });

  it("leaves a sleeping Pip alone outside the hours it runs", async () => {
    // Nothing has run at all, but it's the middle of Saturday night.
    const saturdayNight = new Date("2026-09-12T23:30:00Z");
    expect(await stale(saturdayNight)).toEqual([]);
  });

  it("names the Monday build once the morning has gone", async () => {
    await ran("prices", new Date("2026-09-14T08:50:00Z"));

    const problems = await stale(MONDAY_10AM);
    expect(problems.map((p) => p.job)).toEqual(["weekly_build"]);
    expect(problems[0]!.reason).toContain("9:00 London");
  });

  it("gives the Monday build until the morning is over", async () => {
    await ran("prices", new Date("2026-09-14T07:50:00Z"));
    const earlyMonday = new Date("2026-09-14T07:10:00Z");
    expect(await stale(earlyMonday)).toEqual([]);
  });

  it("doesn't ask for a weekly build on a Tuesday", async () => {
    await ran("prices", new Date("2026-09-15T08:50:00Z"));
    expect(await stale(new Date("2026-09-15T09:00:00Z"))).toEqual([]);
  });

  it("catches a job that started and never finished — an API that died or never woke", async () => {
    await ran("prices", new Date("2026-09-14T08:50:00Z"));
    await ran("weekly_build", new Date("2026-09-14T07:05:00Z"));
    await db.insert(jobRuns).values({
      job: "facts",
      startedAt: new Date("2026-09-14T08:00:00Z"),
      finishedAt: null,
    });

    const problems = await stale(MONDAY_10AM);
    expect(problems.map((p) => p.job)).toEqual(["facts"]);
    expect(problems[0]!.reason).toContain("never finished");
  });

  it("ignores a run that started moments ago and is simply still going", async () => {
    await ran("prices", new Date("2026-09-14T08:50:00Z"));
    await ran("weekly_build", new Date("2026-09-14T07:05:00Z"));
    await db.insert(jobRuns).values({
      job: "facts",
      startedAt: new Date("2026-09-14T08:55:00Z"),
      finishedAt: null,
    });
    expect(await stale(MONDAY_10AM)).toEqual([]);
  });

  it("says nothing at all until Pip has been deployed and configured", async () => {
    await db.execute(sql`delete from private.job_settings`);
    expect(await stale(MONDAY_10AM)).toEqual([]);
    await db.execute(
      sql`insert into private.job_settings (id, refresh_url, job_secret) values (true, 'https://pip.example.com/api/jobs/refresh', 'x')`,
    );
  });
});

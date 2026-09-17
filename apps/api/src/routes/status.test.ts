import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testAuth } from "../test-support/auth.js";
import type { JobStatus, JobStatusReader } from "./status.js";

/**
 * The two ways to see what Pip has been doing (phase-6.md decisions 7 and 10).
 * Neither is called on a schedule: `/status` is a line on Setup, `/health/jobs`
 * is a browser tab. The watching happens inside the database.
 */

const NOW = new Date("2026-09-17T09:00:00Z");
const auth = testAuth();
const SIGNED_IN = auth.headersFor("test@example.com");

function appWith(status: Partial<JobStatus>) {
  const jobs: JobStatusReader = {
    async lastRun() {
      return { lastRunAt: null, lastGoodAt: null, failing: false, ...status };
    },
  };
  return buildApp({ ...auth.options, jobStatus: jobs, now: () => NOW });
}

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe("GET /status", () => {
  it("needs a session — it's about this person's Pip", async () => {
    const response = await appWith({}).inject({ method: "GET", url: "/status" });
    expect(response.statusCode).toBe(401);
  });

  it("says when prices were last checked", async () => {
    const response = await appWith({ lastGoodAt: minutesAgo(12) }).inject({
      method: "GET",
      url: "/status",
      headers: SIGNED_IN,
    });
    expect(response.json()).toEqual({
      lastCheckedAt: minutesAgo(12).toISOString(),
      stale: false,
    });
  });

  it("marks it stale once it's older than the threshold", async () => {
    const response = await appWith({ lastGoodAt: minutesAgo(90) }).inject({
      method: "GET",
      url: "/status",
      headers: SIGNED_IN,
    });
    expect(response.json()).toMatchObject({ stale: true });
  });

  it("says stale, not nothing, before Pip has ever run", async () => {
    const response = await appWith({}).inject({
      method: "GET",
      url: "/status",
      headers: SIGNED_IN,
    });
    expect(response.json()).toEqual({ stale: true });
  });

  it("gives away nothing about why a job failed", async () => {
    const response = await appWith({ lastGoodAt: minutesAgo(5), failing: true }).inject({
      method: "GET",
      url: "/status",
      headers: SIGNED_IN,
    });
    expect(Object.keys(response.json())).toEqual(["lastCheckedAt", "stale"]);
  });
});

describe("GET /health/jobs", () => {
  it("answers without a session, because it says nothing but up or down", async () => {
    const response = await appWith({ lastGoodAt: minutesAgo(5) }).inject({
      method: "GET",
      url: "/health/jobs",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("goes 503 when the last refresh is stale", async () => {
    const response = await appWith({ lastGoodAt: minutesAgo(120) }).inject({
      method: "GET",
      url: "/health/jobs",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "stale" });
  });

  it("goes 503 when the last run failed, however recent it was", async () => {
    const response = await appWith({ lastGoodAt: minutesAgo(5), failing: true }).inject({
      method: "GET",
      url: "/health/jobs",
    });
    expect(response.statusCode).toBe(503);
  });

  it("leaves /health alone for Render's own deploy check", async () => {
    const response = await appWith({ lastGoodAt: minutesAgo(600) }).inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

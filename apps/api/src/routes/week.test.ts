import type { NudgeResponseResult, WeekResponse } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testAuth } from "../test-support/auth.js";

function setup() {
  const auth = testAuth(["test@example.com", "friend@example.test"]);
  const app = buildApp({ ...auth.options });
  return {
    app,
    auth,
    waqar: auth.headersFor("test@example.com"),
    friend: auth.headersFor("friend@example.test"),
  };
}

describe("Your week, in stub mode", () => {
  it("builds this week on read from the sample data and shows it", async () => {
    const { app, waqar } = setup();
    const response = await app.inject({ method: "GET", url: "/week", headers: waqar });
    expect(response.statusCode).toBe(200);
    const body = response.json() as WeekResponse;
    // Built on a Monday 07:00 UTC or later; before that on a Monday, there's no week yet.
    if (body.week) {
      expect(body.week.nudges.length).toBeGreaterThan(0);
      expect(body.week.nudges[0]!.checks.every((c) => c.passed)).toBe(true);
    }
    expect(Array.isArray(body.today)).toBe(true);
  });

  it("refuses a week that isn't a date, and says when there's no such week", async () => {
    const { app, waqar } = setup();
    expect(
      (await app.inject({ method: "GET", url: "/week/last-week", headers: waqar })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: "/week/2020-01-06", headers: waqar })).statusCode,
    ).toBe(404);
  });

  it("records what you did on your own nudge, refuses nonsense, and won't touch someone else's", async () => {
    const { app, waqar, friend } = setup();
    const week = (
      (await app.inject({ method: "GET", url: "/week", headers: waqar })).json() as WeekResponse
    ).week;
    if (!week) return;
    const id = week.nudges[0]!.id;
    const post = (payload: object, headers = waqar) =>
      app.inject({ method: "POST", url: `/nudges/${id}/response`, headers, payload });
    expect((await post({ response: "sold it" })).statusCode).toBe(400);
    expect((await post({ response: "acted" }, friend)).statusCode).toBe(404);
    const saved = await post({ response: "acted" });
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as NudgeResponseResult).response).toBe("acted");
  });
});

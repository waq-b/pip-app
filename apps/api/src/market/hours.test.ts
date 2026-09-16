import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isMarketOpen, scheduleCovers } from "./hours.js";

const exchanges = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../fixtures/recorded/t212/exchanges-sample.json"),
    "utf8",
  ),
) as {
  name: string;
  workingSchedules: { id: number; timeEvents: { date: string; type: string }[] }[];
}[];
const schedule = (id: number) =>
  exchanges.flatMap((e) => e.workingSchedules).find((s) => s.id === id)!.timeEvents;

const LSE = schedule(55); // Greggs
const NASDAQ = schedule(71); // Nvidia

describe("market hours from Trading 212 schedules", () => {
  it("has London open in the day and closed in the evening", () => {
    expect(isMarketOpen(LSE, new Date("2026-09-16T10:00:00Z"))).toBe(true);
    expect(isMarketOpen(LSE, new Date("2026-09-16T16:00:00Z"))).toBe(false);
    expect(isMarketOpen(LSE, new Date("2026-09-16T06:59:00Z"))).toBe(false);
  });

  it("counts only the US regular session, not pre-market or after-hours", () => {
    expect(isMarketOpen(NASDAQ, new Date("2026-09-16T09:00:00Z"))).toBe(false); // pre-market
    expect(isMarketOpen(NASDAQ, new Date("2026-09-16T15:00:00Z"))).toBe(true);
    expect(isMarketOpen(NASDAQ, new Date("2026-09-16T21:00:00Z"))).toBe(false); // after hours
  });

  it("is closed at the weekend", () => {
    expect(isMarketOpen(LSE, new Date("2026-09-19T12:00:00Z"))).toBe(false);
  });

  it("knows when the published schedule has run out", () => {
    expect(scheduleCovers(LSE, new Date("2026-09-16T12:00:00Z"))).toBe(true);
    expect(scheduleCovers(LSE, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});

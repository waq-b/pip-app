import { describe, expect, it } from "vitest";
import { parseStubStaleness } from "./staleness-env.js";

describe("STUB_STALENESS", () => {
  it("is off when unset", () => {
    expect(parseStubStaleness(undefined)).toBeUndefined();
    expect(parseStubStaleness("  ")).toBeUndefined();
  });

  it("reads ages, failures and closed markets, per pot or for all", () => {
    expect(parseStubStaleness("Degen:2, Medium:failed")).toEqual({
      Degen: { hoursOld: 2 },
      Medium: { failed: true },
    });
    expect(parseStubStaleness("all:closed")).toEqual({
      Base: { marketsClosed: true },
      Medium: { marketsClosed: true },
      Degen: { marketsClosed: true },
    });
  });

  it("refuses what it can't read instead of quietly ignoring it", () => {
    expect(() => parseStubStaleness("SideBet:2")).toThrow(/can't read/);
    expect(() => parseStubStaleness("Degen:soon")).toThrow(/can't read/);
    expect(() => parseStubStaleness("Degen")).toThrow(/can't read/);
  });
});

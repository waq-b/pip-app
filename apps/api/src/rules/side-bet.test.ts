import { SIDE_BET_STARTER_LIMIT_PENCE } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { limitFor, moneyInFrom, windowStart, type LedgerEntry } from "./side-bet.js";

/**
 * Side Bet's limit and what it's judged against (phase-6.md decision 13).
 * The point of counting money in, less taken out, is that it moves only when
 * the user moves money — so nothing here depends on a price.
 */

const NOW = new Date("2026-09-17T12:00:00Z");

const entry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  at: new Date("2026-09-01T10:00:00Z"),
  type: "deposit",
  asset: "ZGBP",
  amount: 100,
  ...overrides,
});

describe("the limit", () => {
  it("is the FCA's 10% guide on net assets", () => {
    expect(limitFor(6_400_000)).toEqual({ limitPence: 640_000, starter: false });
  });

  it("is the starter limit until net assets are given", () => {
    expect(limitFor(null)).toEqual({ limitPence: SIDE_BET_STARTER_LIMIT_PENCE, starter: true });
    // Nothing is not an answer that would leave someone with no limit at all.
    expect(limitFor(0)).toEqual({ limitPence: SIDE_BET_STARTER_LIMIT_PENCE, starter: true });
  });

  it("rounds to the penny rather than inventing fractions", () => {
    expect(limitFor(1_234_567)).toEqual({ limitPence: 123_457, starter: false });
  });
});

describe("money in, less taken out", () => {
  it("counts deposits and subtracts withdrawals", () => {
    expect(
      moneyInFrom(
        [
          entry({ amount: 300 }),
          entry({ amount: 150 }),
          entry({ type: "withdrawal", amount: -100 }),
        ],
        NOW,
      ),
    ).toBe(35_000);
  });

  it("never goes below zero, however much comes back out", () => {
    expect(moneyInFrom([entry({ type: "withdrawal", amount: -500 })], NOW)).toBe(0);
  });

  it("only counts the last 12 months", () => {
    const old = new Date("2025-09-16T10:00:00Z");
    expect(windowStart(NOW).toISOString().slice(0, 10)).toBe("2025-09-17");
    expect(moneyInFrom([entry({ at: old, amount: 900 }), entry({ amount: 100 })], NOW)).toBe(
      10_000,
    );
  });

  it("ignores anything that isn't pounds in or out", () => {
    expect(
      moneyInFrom(
        [
          // Buying crypto with pounds already in the account: money moved inside it.
          entry({ type: "trade", amount: -250 }),
          // Staking rewards and the coins themselves aren't money in.
          entry({ type: "deposit", asset: "XXBT", amount: 0.5 }),
          entry({ type: "staking", asset: "DOT", amount: 3 }),
          entry({ amount: 200 }),
        ],
        NOW,
      ),
    ).toBe(20_000);
  });

  it("ignores an entry dated in the future", () => {
    const later = new Date("2026-12-01T10:00:00Z");
    expect(moneyInFrom([entry({ at: later, amount: 500 }), entry({ amount: 100 })], NOW)).toBe(
      10_000,
    );
  });

  it("is nothing at all when the ledger is empty", () => {
    expect(moneyInFrom([], NOW)).toBe(0);
  });
});

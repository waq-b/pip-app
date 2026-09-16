import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { T212AccountSummary, T212Fill, T212Instrument, T212Position } from "./client.js";
import {
  cashRow,
  holdingRows,
  instrumentRow,
  NotInPoundsError,
  toPence,
  tradeRows,
} from "./rows.js";
import { marketSymbolsFor } from "./symbols.js";

const recorded = <T>(name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../fixtures/recorded/t212", name), "utf8"),
  ) as T;
const context = {
  credentialId: "cred-1",
  userId: "user-1",
  polledAt: new Date("2026-09-16T15:00:00Z"),
};

describe("stored rows from Trading 212", () => {
  it("keeps what was held and paid, and drops T212's prices and values", () => {
    const rows = holdingRows(recorded<T212Position[]>("positions.json"), context);
    const greggs = rows.find((row) => row.instrumentId === "GRGl_EQ")!;

    expect(greggs).toEqual({
      ...context,
      instrumentId: "GRGl_EQ",
      quantity: "56.85714285",
      averagePricePaid: "1750.00000022",
      totalCostPence: 99_500,
    });
    expect(JSON.stringify(rows)).not.toMatch(/currentPrice|currentValue/);
  });

  it("stores cash in pence", () => {
    expect(cashRow(recorded<T212AccountSummary>("account-summary.json"), context)).toEqual({
      ...context,
      availablePence: 0,
      reservedPence: 0,
      inPiesPence: 0,
    });
  });

  it("refuses an account that isn't in pounds", () => {
    const summary = { ...recorded<T212AccountSummary>("account-summary.json"), currency: "EUR" };
    expect(() => cashRow(summary, context)).toThrow(NotInPoundsError);
  });

  it("turns pounds into pence without floating-point drift", () => {
    expect(toPence(1997.96)).toBe(199_796);
    expect(toPence(998.5)).toBe(99_850);
    expect(toPence(0.1 + 0.2)).toBe(30);
  });

  it("records fills with fees in pence", () => {
    const fill: T212Fill = {
      orderId: "1",
      fillId: "2",
      ticker: "ASMLa_EQ",
      side: "BUY",
      status: "FILLED",
      quantity: 0.83273192,
      price: 1398.8,
      filledAt: "2026-09-16T14:54:12.000Z",
      walletCurrency: "GBP",
      netValue: 1000,
      fees: 1.5,
    };
    expect(tradeRows([fill], context)[0]).toMatchObject({
      netValuePence: 100_000,
      feesPence: 150,
      quantity: "0.83273192",
    });
  });
});

describe("market-data symbols from T212 tickers", () => {
  it.each([
    ["NVDA_US_EQ", "NVDA", "NVDA"],
    ["GRGl_EQ", "GRG.L", "GRG.LON"],
    ["VWRLl_EQ", "VWRL.L", "VWRL.LON"],
    ["ASMLa_EQ", "ASML.AS", "ASML.AMS"],
    ["VWCEd_EQ", "VWCE.DE", "VWCE.DEX"],
    ["VWRLs_EQ", "VWRL.SW", null],
    ["BRK.B_US_EQ", "BRK-B", "BRK.B"],
  ])("%s → Yahoo %s, Alpha Vantage %s", (ticker, yahoo, alphaVantage) => {
    expect(marketSymbolsFor(ticker)).toEqual({ yahoo, alphaVantage });
  });

  it("returns nothing for a format it doesn't know, so it needs an override", () => {
    expect(marketSymbolsFor("WEIRD")).toEqual({ yahoo: null, alphaVantage: null });
  });

  it("maps every recorded instrument", () => {
    for (const instrument of recorded<T212Instrument[]>("instruments-sample.json")) {
      expect(instrumentRow(instrument).yahooSymbol, instrument.ticker).not.toBeNull();
    }
  });
});

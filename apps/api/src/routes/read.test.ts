import { BUCKETS, type BucketDetail, type InstrumentDetail } from "@finance-app/shared";
import type { PortfolioSummary, RulesView } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createStubMarketData } from "../market/stub/index.js";
import { testAuth } from "../test-support/auth.js";

const auth = testAuth();
const SIGNED_IN = auth.headersFor("test@example.com", "Waqar");

function appForTests(staleness?: Parameters<typeof createStubMarketData>[0]) {
  return buildApp({ ...auth.options, marketData: createStubMarketData(staleness) });
}

async function get<T>(url: string, headers = SIGNED_IN): Promise<T> {
  const response = await appForTests().inject({ method: "GET", url, headers });
  expect(response.statusCode).toBe(200);
  return response.json() as T;
}

describe("GET /portfolio", () => {
  it("needs a session", async () => {
    const response = await appForTests().inject({ method: "GET", url: "/portfolio" });
    expect(response.statusCode).toBe(401);
  });

  it("returns one hero total, the three pots, and freshness for each", async () => {
    const summary = await get<PortfolioSummary>("/portfolio");

    expect(summary.total).toBe(1_143_018);
    expect(summary.buckets.map((b) => b.bucket)).toEqual([...BUCKETS]);
    expect(summary.freshness.map((f) => f.bucket)).toEqual([...BUCKETS]);
  });

  it("pairs every percentage with the money it means", async () => {
    const summary = await get<PortfolioSummary>("/portfolio");

    for (const change of [summary.change, ...summary.buckets.map((b) => b.change)]) {
      expect(change).toHaveProperty("amount");
      expect(change).toHaveProperty("percent");
    }
  });

  it("changes every number when the timeframe changes", async () => {
    const day = await get<PortfolioSummary>("/portfolio?tf=day");
    const month = await get<PortfolioSummary>("/portfolio?tf=month");

    expect(day.change.amount).not.toBe(month.change.amount);
    expect(day.verdict).not.toBe(month.verdict);
  });

  it("names the pot that needs a look rather than claiming all is well", async () => {
    const summary = await get<PortfolioSummary>("/portfolio");

    // Side Bet is over its cap in the fixtures, so "nothing needs you" would be
    // a lie (DESIGN.md §4.3).
    expect(summary.verdict).toContain("Side Bet needs a look");
  });

  it("refuses a timeframe it doesn't know", async () => {
    const response = await appForTests().inject({
      method: "GET",
      url: "/portfolio?tf=fortnight",
      headers: SIGNED_IN,
    });

    expect(response.statusCode).toBe(400);
  });

  it("credits a market source for prices, never a broker", async () => {
    const summary = await get<PortfolioSummary>("/portfolio");

    for (const entry of summary.freshness) {
      expect(entry.freshness.source).not.toMatch(/Trading 212|Kraken/);
    }
  });
});

describe("GET /buckets/:id", () => {
  it("returns the pot, its chart, its money-in bars and its holdings", async () => {
    const detail = await get<BucketDetail>("/buckets/Medium");

    expect(detail.bucket).toBe("Medium");
    expect(detail.holdings).toHaveLength(5);
    expect(detail.chart.series.length).toBeGreaterThan(0);
    expect(detail.moneyIn.months).toHaveLength(6);
    // Three letters on every machine — ICU alone would say "Sept" on some.
    expect(detail.moneyIn.months.map((month) => month.label)).toEqual([
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
    ]);
  });

  it("gives every chart a sentence", async () => {
    const detail = await get<BucketDetail>("/buckets/Base");

    expect(detail.chart.caption.length).toBeGreaterThan(0);
    expect(detail.moneyIn.caption.length).toBeGreaterThan(0);
  });

  it("keeps each holding in its own pot", async () => {
    for (const bucket of BUCKETS) {
      const detail = await get<BucketDetail>(`/buckets/${bucket}`);
      for (const holding of detail.holdings) {
        expect(holding.bucket).toBe(bucket);
      }
    }
  });

  it("404s on a pot that doesn't exist, including the display names", async () => {
    for (const id of ["Foundation", "nope"]) {
      const response = await appForTests().inject({
        method: "GET",
        url: `/buckets/${id}`,
        headers: SIGNED_IN,
      });
      expect(response.statusCode).toBe(404);
    }
  });
});

describe("GET /instruments/:id", () => {
  it("returns the holding with its price, note and series", async () => {
    const detail = await get<InstrumentDetail>("/instruments/nvidia");

    expect(detail.name).toBe("Nvidia");
    expect(detail.bucket).toBe("Medium");
    expect(detail.price).toBeGreaterThan(0);
    expect(detail.note.length).toBeGreaterThan(0);
    expect(detail.series.length).toBeGreaterThan(0);
  });

  it("draws a different number of points per range", async () => {
    const day = await get<InstrumentDetail>("/instruments/nvidia?range=day");
    const all = await get<InstrumentDetail>("/instruments/nvidia?range=all");

    expect(day.series).toHaveLength(24);
    expect(all.series).toHaveLength(36);
  });

  it("ends the series at the price it reports", async () => {
    const detail = await get<InstrumentDetail>("/instruments/bitcoin");

    expect(detail.series.at(-1)?.value).toBe(detail.price);
  });

  it("404s on an unknown holding and 400s on an unknown range", async () => {
    const unknown = await appForTests().inject({
      method: "GET",
      url: "/instruments/dogecoin",
      headers: SIGNED_IN,
    });
    expect(unknown.statusCode).toBe(404);

    const badRange = await appForTests().inject({
      method: "GET",
      url: "/instruments/nvidia?range=decade",
      headers: SIGNED_IN,
    });
    expect(badRange.statusCode).toBe(400);
  });
});

describe("GET /rules", () => {
  it("calls Side Bet a cap and the others targets", async () => {
    const view = await get<RulesView>("/rules");

    expect(view.rules.find((r) => r.bucket === "Degen")?.kind).toBe("cap");
    expect(view.rules.find((r) => r.bucket === "Base")?.kind).toBe("target");
  });

  it("says how far over the cap Side Bet is, in pounds as well as percent", async () => {
    const view = await get<RulesView>("/rules");
    const degen = view.rules.find((r) => r.bucket === "Degen");

    expect(degen?.overBy).toEqual({ percent: 1.8, amount: 20_800 });
  });

  it("marks no other pot as over", async () => {
    const view = await get<RulesView>("/rules");

    for (const rule of view.rules.filter((r) => r.bucket !== "Degen")) {
      expect(rule.overBy).toBeUndefined();
    }
  });

  it("describes the monthly split as the user's own, adding up to the total", async () => {
    const view = await get<RulesView>("/rules");
    const sum = view.monthlySplit.perBucket.reduce((total, part) => total + part.amount, 0);

    expect(sum).toBe(view.monthlySplit.total);
  });
});

describe("GET /activity and /connections", () => {
  it("never has one pot's money buying another pot's holding", async () => {
    const activity = await get<{ bucket: string; text: string }[]>("/activity");
    const isa = activity.filter((entry) => entry.text.includes("ISA"));

    // The prototype had ISA money buying Rolls-Royce, which lives in Handpicked.
    for (const entry of isa) {
      expect(entry.bucket).toBe("Base");
      expect(entry.text).not.toMatch(/Rolls-Royce|Nvidia|Bitcoin/);
    }
  });

  it("lists only the providers this phase supports", async () => {
    const connections = await get<{ provider: string }[]>("/connections");

    expect(connections.map((c) => c.provider).sort()).toEqual(["kraken", "trading212"]);
  });
});

describe("freshness drives the staleness ladder", () => {
  it("can report one pot behind while the others are current", async () => {
    const app = appForTests({ staleness: { Degen: { hoursOld: 2 } } });
    const response = await app.inject({ method: "GET", url: "/portfolio", headers: SIGNED_IN });
    const summary = response.json() as PortfolioSummary;

    const degen = summary.freshness.find((f) => f.bucket === "Degen")!;
    const base = summary.freshness.find((f) => f.bucket === "Base")!;

    expect(new Date(degen.freshness.asOf).getTime()).toBeLessThan(
      new Date(base.freshness.asOf).getTime(),
    );
  });
});

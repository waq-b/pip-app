import { describe, expect, it } from "vitest";
import { alphaVantageEarningsAdapter, alphaVantageNewsAdapter } from "./sources/alpha-vantage.js";
import { googleNewsAdapter } from "./sources/google-news.js";
import { marketauxAdapter } from "./sources/marketaux.js";
import { companyFeedsAdapter, GENERAL_FEEDS, generalFeedAdapter } from "./sources/rss.js";
import { adaptersFor, aliasesFor, factsTarget, mentions, regionFor } from "./targets.js";

const practice = {
  nvidia: factsTarget({ id: "NVDA_US_EQ", name: "Nvidia", shortName: "NVDA", type: "STOCK" }),
  greggs: factsTarget({ id: "GRGl_EQ", name: "Greggs", shortName: "GRG", type: "STOCK" }),
  asml: factsTarget({ id: "ASMLa_EQ", name: "ASML", shortName: "ASML", type: "STOCK" }),
  vwrl: factsTarget({
    id: "VWRLl_EQ",
    name: "Vanguard FTSE All-World (Dist)",
    shortName: "VWRL",
    type: "ETF",
  }),
  bitcoin: factsTarget({ id: "kraken:XBT", name: "Bitcoin", shortName: "btc", type: "CRYPTO" }),
};

describe("where a holding trades and what it is", () => {
  it.each([
    ["NVDA_US_EQ", "STOCK", "US"],
    ["GRGl_EQ", "STOCK", "UK"],
    ["ASMLa_EQ", "STOCK", "EU"],
    ["VWCEd_EQ", "ETF", "EU"],
    ["SHOP_CA_EQ", "STOCK", "other"],
    ["kraken:XBT", "CRYPTO", "global"],
  ])("%s is %s in %s", (id, type, region) => {
    expect(regionFor(id, type)).toBe(region);
  });

  it("reads the practice holdings", () => {
    expect(practice.vwrl).toMatchObject({ region: "UK", asset: "etf" });
    expect(practice.bitcoin).toMatchObject({ region: "global", asset: "crypto", shortName: "BTC" });
  });
});

describe("aliases", () => {
  it("cleans legal words and share classes out of names", () => {
    expect(aliasesFor("Vanguard FTSE All-World (Dist)", "VWRL").names).toEqual([
      "Vanguard FTSE All-World",
    ]);
    expect(aliasesFor("ASML Holding N.V.", "ASML").names).toEqual(["ASML"]);
    expect(aliasesFor("Rolls-Royce Holdings plc", "RR")).toEqual({
      names: ["Rolls-Royce"],
      tickers: [],
    });
  });

  it("matches a name as a whole word, any case", () => {
    expect(mentions(practice.greggs, "Shoplifting front line in Greggs")).toBe(true);
    expect(mentions(practice.greggs, "GREGGS results beat forecasts")).toBe(true);
    expect(mentions(practice.greggs, "Greggsville council meets")).toBe(false);
  });

  it("matches a ticker only in capitals", () => {
    expect(mentions(practice.nvidia, "NVDA slips after the close")).toBe(true);
    expect(mentions(practice.greggs, "GRG shares rise")).toBe(true);
    expect(mentions(practice.greggs, "the grg of it")).toBe(false);
  });

  it("matches a coin by name or symbol", () => {
    expect(mentions(practice.bitcoin, "Bitcoin holds steady")).toBe(true);
    expect(mentions(practice.bitcoin, "BTC ETF flows")).toBe(true);
    expect(mentions(practice.bitcoin, "Ethereum upgrade lands")).toBe(false);
  });
});

describe("sources per holding, from their declared coverage", () => {
  const adapters = [
    googleNewsAdapter(),
    marketauxAdapter({ apiKey: "k" }),
    alphaVantageNewsAdapter({ apiKey: "k" }),
    companyFeedsAdapter(),
    alphaVantageEarningsAdapter({ apiKey: "k" }),
    ...GENERAL_FEEDS.map((feed) => generalFeedAdapter(feed)),
  ];
  const ids = (target: (typeof practice)[keyof typeof practice]) =>
    adaptersFor(target, adapters).map((adapter) => adapter.id);

  it.each([
    ["nvidia", ["google-news", "marketaux", "alpha-vantage", "rss:company"]],
    ["asml", ["google-news", "marketaux", "alpha-vantage"]],
    ["greggs", ["google-news", "marketaux"]],
    ["vwrl", ["google-news", "marketaux"]],
    ["bitcoin", ["marketaux", "alpha-vantage"]],
  ] as const)("%s is read from %j (plus the general feeds)", (name, expected) => {
    expect(ids(practice[name])).toEqual(expected);
  });
});

describe("the live source list", () => {
  it("always has the keyless sources, and adds keyed ones only when configured", async () => {
    const { liveFactsAdapters } = await import("./live.js");
    const keyless = liveFactsAdapters({}).map((adapter) => adapter.id);
    expect(keyless).toEqual([
      ...GENERAL_FEEDS.map((feed) => feed.id),
      "google-news",
      "rss:company",
    ]);
    const all = liveFactsAdapters({ alphaVantageKey: "a", marketauxKey: "m" });
    expect(all.map((adapter) => `${adapter.scope}:${adapter.id}`).slice(-3)).toEqual([
      "holding:marketaux",
      "holding:alpha-vantage",
      "events:alpha-vantage",
    ]);
  });
});

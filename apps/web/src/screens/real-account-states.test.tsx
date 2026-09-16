import type {
  BucketDetail,
  BucketSummary,
  InstrumentDetail,
  PortfolioSummary,
  RulesView,
} from "@finance-app/shared";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute } from "../test/render-route";
import { PHONE_WIDTH, setViewportWidth } from "../test/setup";

/**
 * Real Trading 212 accounts (Phase 2) have states the sample data never did:
 * Side Bet not connected yet, a pot still reading its account, not enough
 * history for a timeframe, and blocks that aren't built from real data yet.
 * Each must say so — never show sample numbers or a made-up £0 change.
 */

const now = new Date(Date.now() - 2 * 60_000).toISOString();
const freshness = { source: "Yahoo Finance", asOf: now, failed: false, marketsClosed: false };
const flat = { amount: 0, percent: 0, direction: "flat" as const };

function pot(overrides: Partial<BucketSummary>): BucketSummary {
  return {
    bucket: "Base",
    status: "live",
    value: 500_307,
    change: { amount: 1_257, percent: 0.25, direction: "up" },
    blurb: "Your Stocks & Shares ISA",
    shareOfTotal: 100,
    targetPercent: 70,
    series: [],
    ...overrides,
  };
}

function portfolio(overrides: Partial<PortfolioSummary> = {}): PortfolioSummary {
  return {
    timeframe: "day",
    total: 500_307,
    change: { amount: 1_257, percent: 0.25, direction: "up" },
    verdict: "Up £12.57 today. Nothing needs you.",
    buckets: [
      pot({}),
      pot({
        bucket: "Medium",
        status: "syncing",
        value: 0,
        change: flat,
        shareOfTotal: 0,
        targetPercent: 25,
        blurb: "Your Invest account",
      }),
      pot({
        bucket: "Degen",
        status: "not_connected",
        value: 0,
        change: flat,
        shareOfTotal: 0,
        targetPercent: 5,
        blurb: "Your Kraken account",
      }),
    ],
    freshness: (["Base", "Medium", "Degen"] as const).map((bucket) => ({ bucket, freshness })),
    activityComingSoon: true,
    ...overrides,
  };
}

beforeEach(() => setViewportWidth(PHONE_WIDTH));

describe("Pots with real accounts", () => {
  it("says Side Bet isn't connected and a pot is still reading, instead of showing £0 changes", async () => {
    renderRoute("/", {
      session: WAQAR,
      api: {
        ...ME_ALLOWED,
        "/portfolio": { body: portfolio() },
        "/activity": { body: [] },
        "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
      },
    });

    const sideBet = (await screen.findByText("Your Kraken account")).closest("a")!;
    expect(sideBet).toHaveTextContent("Not connected yet");
    expect(sideBet).not.toHaveTextContent("+£0");
    expect(screen.getByText("Your Invest account").closest("a")).toHaveTextContent(
      "Reading your account…",
    );
  });

  it("says what changed is coming soon", async () => {
    renderRoute("/", {
      session: WAQAR,
      api: {
        ...ME_ALLOWED,
        "/portfolio": { body: portfolio() },
        "/activity": { body: [] },
        "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
      },
    });
    expect(
      await screen.findByText(/Coming soon\. Once Pip reads your account history/),
    ).toBeInTheDocument();
  });

  it("says there isn't enough history for the timeframe rather than inventing a change", async () => {
    const noMonth = portfolio({
      changeUnavailable: true,
      change: flat,
      verdict: "Pip is still gathering your history.",
      buckets: [pot({ changeUnavailable: true, change: flat })],
    });
    renderRoute("/", {
      session: WAQAR,
      api: {
        ...ME_ALLOWED,
        "/portfolio": { body: noMonth },
        "/activity": { body: [] },
        "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
      },
    });

    expect(
      await screen.findByText("Not enough history yet to say how you did today."),
    ).toBeInTheDocument();
    expect(screen.getByText("Your Stocks & Shares ISA").closest("a")).toHaveTextContent(
      "Not enough history yet",
    );
    expect(screen.queryByText(/\+£0\.00/)).not.toBeInTheDocument();
  });
});

function bucketDetail(overrides: Partial<BucketDetail>): BucketDetail {
  return {
    bucket: "Base",
    status: "live",
    value: 500_307,
    change: { amount: 1_257, percent: 0.25, direction: "up" },
    blurb: "Your Stocks & Shares ISA",
    plain: "The long-term money.",
    chart: { from: "", series: [], caption: "" },
    moneyIn: { months: [], caption: "", comingSoon: true },
    holdings: [
      {
        id: "GRGl_EQ",
        name: "Greggs",
        subtitle: "GRG",
        bucket: "Base",
        value: 99_557,
        today: flat,
        sinceBought: { amount: 57, percent: 0.06, direction: "up" },
        shareOfBucket: 20,
        series: [],
      },
      {
        id: "cash:Base",
        name: "Cash",
        subtitle: "Not invested yet",
        bucket: "Base",
        value: 2_000,
        today: flat,
        sinceBought: flat,
        shareOfBucket: 1,
        series: [],
        linkable: false,
      },
    ],
    freshness,
    ...overrides,
  };
}

describe("a pot with a real account", () => {
  it("lists cash without a link, and says money in is coming soon", async () => {
    renderRoute("/pots/Base", {
      session: WAQAR,
      api: { ...ME_ALLOWED, "/buckets/Base": { body: bucketDetail({}) } },
    });

    const cash = await screen.findByText("Cash");
    expect(cash.closest("a")).toBeNull();
    expect(screen.getByText("Greggs").closest("a")).toHaveAttribute("href", "/instruments/GRGl_EQ");
    expect(
      screen.getByText(/Coming soon\. Once Pip reads your account history, what you paid in/),
    ).toBeInTheDocument();
  });

  it("shows Side Bet as not connected yet, with no sample money, pointing to Kraken", async () => {
    const sideBet = bucketDetail({
      bucket: "Degen",
      status: "not_connected",
      value: 0,
      holdings: [],
      change: flat,
    });
    renderRoute("/pots/Degen", {
      session: WAQAR,
      api: { ...ME_ALLOWED, "/buckets/Degen": { body: sideBet } },
    });

    expect(await screen.findByText("Not connected yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Connect your Kraken account with a read-only key/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Kraken" })).toHaveAttribute("href", "/setup");
    expect(screen.queryByText("£0")).not.toBeInTheDocument();
  });

  it("says a pot still reading its account is doing so", async () => {
    const syncing = bucketDetail({
      bucket: "Medium",
      status: "syncing",
      value: 0,
      holdings: [],
      change: flat,
    });
    renderRoute("/pots/Medium", {
      session: WAQAR,
      api: { ...ME_ALLOWED, "/buckets/Medium": { body: syncing } },
    });
    expect(
      await screen.findByText(/Pip is reading your account for the first time/),
    ).toBeInTheDocument();
  });
});

describe("a real holding", () => {
  it("leaves out the plain-English note until there is one", async () => {
    const detail: InstrumentDetail = {
      id: "GRGl_EQ",
      name: "Greggs",
      ticker: "GRG",
      bucket: "Base",
      quantity: "56.8571 shares",
      price: 1_751,
      value: 99_557,
      today: flat,
      sinceBought: flat,
      note: "",
      range: "all",
      series: [],
      freshness,
    };
    renderRoute("/instruments/GRGl_EQ", {
      session: WAQAR,
      api: { ...ME_ALLOWED, "/instruments/GRGl_EQ": { body: detail } },
    });

    expect(await screen.findByRole("heading", { name: "Greggs" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "In plain English" })).not.toBeInTheDocument();
  });
});

describe("Side Bet from Kraken", () => {
  const coins = bucketDetail({
    bucket: "Degen",
    value: 57_000,
    blurb: "Your Kraken account",
    freshness: { ...freshness, source: "CoinGecko" },
    holdings: [
      {
        id: "kraken:DOT",
        name: "Polkadot",
        subtitle: "DOT · incl. 13 staked",
        bucket: "Degen",
        value: 6_000,
        today: flat,
        sinceBought: flat,
        sinceBoughtUnavailable: true,
        shareOfBucket: 10.5,
        series: [],
      },
      {
        id: "kraken:XBT",
        name: "Bitcoin",
        subtitle: "BTC",
        bucket: "Degen",
        value: 50_000,
        today: flat,
        sinceBought: { amount: 10_000, percent: 25, direction: "up" },
        shareOfBucket: 87.7,
        series: [],
      },
    ],
  });

  it("lists coins with what's staked, and says when a cost isn't known yet", async () => {
    renderRoute("/pots/Degen", {
      session: WAQAR,
      api: { ...ME_ALLOWED, "/buckets/Degen": { body: coins } },
    });
    const polkadot = (await screen.findByText("Polkadot")).closest("a")!;
    expect(polkadot).toHaveTextContent("DOT · incl. 13 staked");
    expect(polkadot).toHaveTextContent("Cost not known yet");
    expect(polkadot).not.toHaveTextContent("+£0.00");
    expect(screen.getByText("Bitcoin").closest("a")).toHaveTextContent("+£100.00");
  });

  it("says a coin's cost isn't known yet on its own page", async () => {
    const detail: InstrumentDetail = {
      id: "kraken:DOT",
      name: "Polkadot",
      ticker: "DOT",
      bucket: "Degen",
      quantity: "15 DOT",
      price: 400,
      value: 6_000,
      today: flat,
      sinceBought: flat,
      sinceBoughtUnavailable: true,
      note: "",
      range: "all",
      series: [],
      freshness: { ...freshness, source: "CoinGecko" },
    };
    renderRoute("/instruments/kraken:DOT", {
      session: WAQAR,
      api: { ...ME_ALLOWED, "/instruments/kraken%3ADOT": { body: detail } },
    });
    expect(await screen.findByRole("heading", { name: "Polkadot" })).toBeInTheDocument();
    expect(screen.getByText(/15 DOT · £4\.00 each/)).toBeInTheDocument();
    expect(screen.getByText("Cost not known yet")).toBeInTheDocument();
  });
});

describe("rules with real accounts", () => {
  it("says Side Bet isn't connected and the monthly split is coming soon", async () => {
    const view: RulesView = {
      rules: [
        {
          bucket: "Base",
          kind: "target",
          targetPercent: 70,
          actualPercent: 100,
          available: true,
          plain: "Foundation is 100% of your money, against the 70% you set.",
        },
        {
          bucket: "Medium",
          kind: "target",
          targetPercent: 25,
          actualPercent: 0,
          available: false,
          plain: "Connect your Trading 212 Invest account in Setup to see where it sits.",
        },
        {
          bucket: "Degen",
          kind: "cap",
          targetPercent: 5,
          actualPercent: 0,
          available: false,
          plain: "Side Bet arrives in a later update. Nothing is counted here yet.",
        },
      ],
      monthlySplit: { total: 0, perBucket: [], comingSoon: true },
    };
    renderRoute("/rules", { session: WAQAR, api: { ...ME_ALLOWED, "/rules": { body: view } } });

    const sideBet = (await screen.findByRole("heading", { name: "Side Bet" })).closest("section")!;
    expect(within(sideBet).getByText("Not connected yet")).toBeInTheDocument();
    expect(screen.getByText(/Coming soon\. Pip will read the monthly split/)).toBeInTheDocument();
    expect(screen.queryByText(/a month you pay in/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

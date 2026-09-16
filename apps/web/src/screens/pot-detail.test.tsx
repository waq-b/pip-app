import type { BucketDetail, Holding } from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute, type Handler } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth } from "../test/setup";

const series = [
  { at: "2026-01-01T00:00:00Z", value: 100 },
  { at: "2026-06-01T00:00:00Z", value: 140 },
  { at: "2026-09-01T00:00:00Z", value: 130 },
];

const change = (amount: number, percent: number) => ({
  amount,
  percent,
  direction: amount > 0 ? ("up" as const) : amount < 0 ? ("down" as const) : ("flat" as const),
});

function holding(
  id: string,
  name: string,
  bucket: Holding["bucket"],
  value: number,
  share: number,
): Holding {
  return {
    id,
    name,
    subtitle: `${name} subtitle`,
    bucket,
    value,
    today: change(100, 0.5),
    sinceBought: change(2_000, 6),
    shareOfBucket: share,
    series,
  };
}

function detail(overrides: Partial<BucketDetail> = {}): BucketDetail {
  return {
    bucket: "Degen",
    value: 78_000,
    change: change(530, 0.68),
    blurb: "The fun money.",
    plain: "Assume you could lose the lot.",
    chart: { from: "Jan 2025", series, caption: "Up 56% overall, and down 40% twice on the way." },
    moneyIn: {
      months: [
        { label: "Apr", amount: 1_000 },
        { label: "Jul", amount: 0 },
      ],
      caption: "Nothing new has gone in since June.",
    },
    holdings: [
      holding("bitcoin", "Bitcoin", "Degen", 43_000, 55),
      holding("ethereum", "Ethereum", "Degen", 22_000, 28),
    ],
    freshness: {
      source: "Sample prices · stub data",
      asOf: "2026-09-16T09:00:00Z",
      failed: false,
      marketsClosed: false,
    },
    ...overrides,
  };
}

function api(buckets: Handler = { body: detail() }): Record<string, Handler> {
  return { ...ME_ALLOWED, "/buckets/Degen": buckets, "/buckets/Base": buckets };
}

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
});

describe("the pot detail screen", () => {
  it("heads with the pot's name, its badge, and what it's worth", async () => {
    renderRoute("/pots/Degen", { session: WAQAR, api: api() });

    expect(await screen.findByRole("heading", { name: "Side Bet", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Capped")).toBeInTheDocument();
    expect(screen.getByText("£780")).toBeInTheDocument();
    expect(screen.getByText("Assume you could lose the lot.")).toBeInTheDocument();
  });

  it("keeps Side Bet fenced here too", async () => {
    renderRoute("/pots/Degen", { session: WAQAR, api: api() });

    const heading = await screen.findByRole("heading", { name: "Side Bet", level: 1 });
    expect(heading.closest("section")).toHaveClass("hatch", "border-acc");
  });

  it("gives the chart and the money-in bars their sentences", async () => {
    renderRoute("/pots/Degen", { session: WAQAR, api: api() });

    expect(
      await screen.findByText("Up 56% overall, and down 40% twice on the way."),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing new has gone in since June.")).toBeInTheDocument();
    expect(screen.getByText("Prices: Sample prices · stub data")).toBeInTheDocument();
  });

  it("lists what's inside, each holding linking to its own page", async () => {
    renderRoute("/pots/Degen", { session: WAQAR, api: api() });

    const bitcoin = await screen.findByRole("link", { name: /Bitcoin/ });
    expect(bitcoin).toHaveAttribute("href", "/instruments/bitcoin");
    expect(screen.getByRole("img", { name: /Bitcoin 55%, Ethereum 28%/ })).toBeInTheDocument();
  });

  it("names the provider where you'd actually buy or sell", async () => {
    renderRoute("/pots/Degen", { session: WAQAR, api: api() });

    expect(
      await screen.findByText("Read-only. To buy or sell, use Kraken — Pip just keeps score."),
    ).toBeInTheDocument();
  });

  it("links back to the pots", async () => {
    renderRoute("/pots/Degen", { session: WAQAR, api: api() });
    expect(await screen.findByRole("link", { name: "Back to your pots" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("the pot detail screen's other states", () => {
  it("shows the shape while loading", async () => {
    const { container } = renderRoute("/pots/Degen", { session: WAQAR, api: api() });

    await waitFor(() =>
      expect(container.querySelector('[aria-busy="true"] [data-skeleton]')).toBeInTheDocument(),
    );
  });

  it("keeps the value and replaces only the chart when there's no history", async () => {
    renderRoute("/pots/Degen", {
      session: WAQAR,
      api: api({ body: detail({ chart: { from: "Today", series: [], caption: "unused" } }) }),
    });

    expect(await screen.findByText("£780")).toBeInTheDocument();
    expect(screen.getByText("Can't draw the chart right now")).toBeInTheDocument();
    expect(screen.getByText(/only the history that's missing/)).toBeInTheDocument();
  });

  it("says Side Bet may stay empty, and offers to connect Kraken", async () => {
    renderRoute("/pots/Degen", {
      session: WAQAR,
      api: api({ body: detail({ value: 0, holdings: [] }) }),
    });

    expect(await screen.findByText(/perfectly good place to leave it/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Kraken" })).toHaveAttribute("href", "/setup");
    expect(
      screen.getByText("You don't need this pot. It's just allowed to exist."),
    ).toBeInTheDocument();
  });

  it("reassures and offers a retry when the pot can't load", async () => {
    let calls = 0;
    renderRoute("/pots/Degen", {
      session: WAQAR,
      api: api(() => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "down" } } : { body: detail() };
      }),
    });

    expect(
      await screen.findByRole("heading", { name: "Can't load this pot right now" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("£780")).toBeInTheDocument();
  });

  it("says there's no such pot for a display name in the URL, without asking the API", async () => {
    const { fetchMock } = renderRoute("/pots/Foundation", { session: WAQAR, api: api() });

    expect(await screen.findByRole("heading", { name: "No such pot" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/buckets"))).toBe(
      false,
    );
  });

  it("says there's no such pot when the API doesn't know it", async () => {
    renderRoute("/pots/Base", {
      session: WAQAR,
      api: api({ status: 404, body: { error: "unknown_bucket" } }),
    });

    expect(await screen.findByRole("heading", { name: "No such pot" })).toBeInTheDocument();
  });
});

describe("the pot detail screen on desktop", () => {
  it("restores the fourth column in the holdings table", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/pots/Degen", { session: WAQAR, api: api() });

    expect(
      await screen.findByRole("button", { name: /Sort by since you bought/ }),
    ).toBeInTheDocument();
    // The table's column header, not the chart's "Today" axis label.
    expect(screen.getByText("Today", { selector: "span.text-right" })).toBeInTheDocument();
  });

  it("lists the three pots under Pots in the sidebar, with this one lit", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/pots/Degen", { session: WAQAR, api: api() });

    const nav = await screen.findByRole("navigation", { name: "Sections" });
    const sideBet = within(nav).getByRole("link", { name: "Side Bet" });
    expect(sideBet).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Foundation" })).toHaveAttribute(
      "href",
      "/pots/Base",
    );
  });
});

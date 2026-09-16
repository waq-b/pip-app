import type { InstrumentDetail, PriceRange } from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { priceCaption, rangeStartLabel } from "../lib/instrument";
import { MINUS } from "../lib/format";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute, type Handler } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth } from "../test/setup";

const change = (amount: number, percent: number) => ({
  amount,
  percent,
  direction: amount > 0 ? ("up" as const) : amount < 0 ? ("down" as const) : ("flat" as const),
});

function series(values: number[], start = "2026-08-17T00:00:00Z") {
  const base = new Date(start).getTime();
  return values.map((value, index) => ({
    at: new Date(base + index * 24 * 60 * 60 * 1000).toISOString(),
    value,
  }));
}

function instrument(
  range: PriceRange = "all",
  overrides: Partial<InstrumentDetail> = {},
): InstrumentDetail {
  return {
    id: "nvidia",
    name: "Nvidia",
    ticker: "NVDA",
    bucket: "Medium",
    quantity: "5.04 shares",
    price: 14_280,
    value: 72_000,
    today: change(410, 2.9),
    sinceBought: change(-1_330, -3),
    note: "Makes the chips that AI runs on.",
    range,
    series: range === "month" ? series([11_820, 14_280]) : series([10_000, 12_000, 14_280]),
    freshness: {
      source: "Sample prices · stub data",
      asOf: new Date(Date.now() - 4 * 60_000).toISOString(),
      failed: false,
      marketsClosed: false,
    },
    ...overrides,
  };
}

function api(handler?: Handler): Record<string, Handler> {
  return {
    ...ME_ALLOWED,
    "/instruments/nvidia":
      handler ??
      ((_init, url) => ({
        body: instrument((url.searchParams.get("range") as PriceRange) ?? "all"),
      })),
  };
}

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
});

describe("chart words", () => {
  it("says what the price did in pounds, never a bare percentage", () => {
    const caption = priceCaption(series([11_820, 14_280]), "month");

    expect(caption).toBe("The price went from £118.20 to £142.80 over the last month.");
    expect(caption).not.toContain("%");
  });

  it("says so when the price is where it started", () => {
    expect(priceCaption(series([500, 500]), "day")).toBe("The price is where it started, today.");
  });

  it("labels where the chart starts, by range", () => {
    expect(rangeStartLabel(series([1, 2]), "day")).toBe("This morning");
    expect(rangeStartLabel(series([1, 2]), "all")).toBe("Since you bought");
    expect(rangeStartLabel(series([1, 2]), "month")).toBe("17 Aug");
    expect(rangeStartLabel(series([1, 2], "2025-09-01T00:00:00Z"), "year")).toBe("Sep 2025");
  });
});

describe("the instrument screen", () => {
  it("names the holding, its pot and ticker, and what one costs", async () => {
    renderRoute("/instruments/nvidia", { session: WAQAR, api: api() });

    expect(await screen.findByRole("heading", { name: "Nvidia", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Handpicked")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByText("5.04 shares · £142.80 each")).toBeInTheDocument();
  });

  it("says what it's worth to you, and each movement leads with pounds", async () => {
    const { container } = renderRoute("/instruments/nvidia", { session: WAQAR, api: api() });

    expect(await screen.findByText("£720")).toBeInTheDocument();
    const text = container.textContent ?? "";
    expect(text).toContain("+£4.10 · +2.9%");
    expect(text).toContain(`${MINUS}£13.30 · ${MINUS}3%`);
  });

  it("gives the price chart a sentence", async () => {
    renderRoute("/instruments/nvidia", { session: WAQAR, api: api() });

    expect(
      await screen.findByText("The price went from £100.00 to £142.80 since you bought."),
    ).toBeInTheDocument();
    expect(screen.getByText("Sample prices · stub data · updated 4 min ago")).toBeInTheDocument();
  });

  it("redraws for a different range", async () => {
    const { fetchMock } = renderRoute("/instruments/nvidia", { session: WAQAR, api: api() });
    await screen.findByText(/since you bought\./);

    fireEvent.click(screen.getByRole("radio", { name: "Month" }));

    expect(
      await screen.findByText("The price went from £118.20 to £142.80 over the last month."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === "/instruments/nvidia?range=month"),
    ).toBe(true);
  });

  it("explains it in plain English, marked as information, not advice", async () => {
    renderRoute("/instruments/nvidia", { session: WAQAR, api: api() });

    const heading = await screen.findByRole("heading", { name: "In plain English" });
    const explainer = heading.parentElement!;
    expect(within(explainer).getByText("Makes the chips that AI runs on.")).toBeInTheDocument();
    expect(within(explainer).getByText(/information, not advice/i)).toBeInTheDocument();
  });

  it("goes back to its pot, and names the provider for buying and selling", async () => {
    renderRoute("/instruments/nvidia", { session: WAQAR, api: api() });

    expect(await screen.findByRole("link", { name: "Back to Handpicked" })).toHaveAttribute(
      "href",
      "/pots/Medium",
    );
    expect(
      screen.getByText("Read-only. To buy or sell, use Trading 212 — Pip just keeps score."),
    ).toBeInTheDocument();
  });
});

describe("the instrument screen's other states", () => {
  it("shows the shape while loading", async () => {
    const { container } = renderRoute("/instruments/nvidia", { session: WAQAR, api: api() });

    await waitFor(() =>
      expect(container.querySelector('[aria-busy="true"] [data-skeleton]')).toBeInTheDocument(),
    );
  });

  it("won't draw one day as a trend", async () => {
    renderRoute("/instruments/nvidia", {
      session: WAQAR,
      api: api({ body: instrument("all", { series: series([14_280]) }) }),
    });

    expect(await screen.findByText("No history yet — come back tomorrow")).toBeInTheDocument();
    expect(
      screen.getByText("One day is not a trend, so Pip won't draw you one."),
    ).toBeInTheDocument();
    expect(screen.getByText("£720")).toBeInTheDocument();
  });

  it("reassures and offers a retry when it can't load", async () => {
    let calls = 0;
    renderRoute("/instruments/nvidia", {
      session: WAQAR,
      api: api(() => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "down" } } : { body: instrument() };
      }),
    });

    expect(
      await screen.findByRole("heading", { name: "Can't load this holding right now" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("£720")).toBeInTheDocument();
  });

  it("says there's no such holding when the API doesn't know it", async () => {
    renderRoute("/instruments/nvidia", {
      session: WAQAR,
      api: api({ status: 404, body: { error: "unknown_instrument" } }),
    });

    expect(await screen.findByRole("heading", { name: "No such holding" })).toBeInTheDocument();
  });
});

describe("the instrument screen on desktop", () => {
  it("trades the back link for a breadcrumb", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/instruments/nvidia", { session: WAQAR, api: api() });

    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Handpicked" })).toHaveAttribute(
      "href",
      "/pots/Medium",
    );
    expect(within(crumbs).getByText("Nvidia")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Back to Handpicked" })).not.toBeInTheDocument();
  });
});

describe("the staleness ladder on a holding", () => {
  it("shows an amber line and an age chip, keeping the figure at full strength", async () => {
    const twoHoursAgo = new Date(Date.now() - 125 * 60_000).toISOString();
    renderRoute("/instruments/nvidia", {
      session: WAQAR,
      api: api({
        body: instrument("all", {
          freshness: {
            source: "Sample prices · stub data",
            asOf: twoHoursAgo,
            failed: false,
            marketsClosed: false,
          },
        }),
      }),
    });

    expect(await screen.findByText("Price is 2 hours old")).toHaveAttribute("data-state", "amber");
    expect(screen.getByText("2h old")).toBeInTheDocument();
    expect(
      screen.getByText("What it's worth to you").closest(".opacity-60"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

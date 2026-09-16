import type {
  ActivityEntry,
  BucketSummary,
  PortfolioSummary,
  Timeframe,
} from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute, type Handler } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth, TABLET_WIDTH } from "../test/setup";

const series = [
  { at: "2026-09-14T00:00:00Z", value: 100 },
  { at: "2026-09-15T00:00:00Z", value: 110 },
];

function pot(
  bucket: BucketSummary["bucket"],
  value: number,
  share: number,
  target: number,
): BucketSummary {
  return {
    bucket,
    value,
    change: { amount: 1_140, percent: 0.14, direction: "up" },
    blurb: `${bucket} blurb`,
    shareOfTotal: share,
    targetPercent: target,
    series,
  };
}

function portfolio(
  timeframe: Timeframe,
  overrides: Partial<PortfolioSummary> = {},
): PortfolioSummary {
  return {
    timeframe,
    total: 1_143_018,
    change: { amount: timeframe === "day" ? 2_580 : 12_040, percent: 0.23, direction: "up" },
    verdict:
      timeframe === "day"
        ? "Up £25.80 today. Side Bet needs a look."
        : "Up £120.40 this month. Side Bet needs a look.",
    buckets: [
      pot("Base", 824_000, 72, 70),
      pot("Medium", 241_000, 21, 25),
      pot("Degen", 78_000, 6.8, 5),
    ],
    freshness: (["Base", "Medium", "Degen"] as const).map((bucket) => ({
      bucket,
      freshness: {
        source: "Sample prices · stub data",
        asOf: new Date(Date.now() - 4 * 60_000).toISOString(),
        failed: false,
        marketsClosed: false,
      },
    })),
    ...overrides,
  };
}

const activity: ActivityEntry[] = [
  {
    id: "1",
    bucket: "Base",
    kind: "money_in",
    text: "£140 of your ISA bought Vanguard FTSE Global All Cap",
    when: "Monday · automatic",
  },
  {
    id: "2",
    bucket: "Degen",
    kind: "alert",
    text: "Side Bet crept 1.8% over its 5% cap",
    when: "Wednesday · needs a look",
  },
];

function api(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...ME_ALLOWED,
    "/portfolio": (_init, url) => ({
      body: portfolio((url.searchParams.get("tf") as Timeframe) ?? "day"),
    }),
    "/activity": { body: activity },
    ...extra,
  };
}

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
});

describe("the pots screen", () => {
  it("leads with everything you own as one number, pence set apart", async () => {
    renderRoute("/", { session: WAQAR, api: api() });

    expect(await screen.findByText("£11,430")).toBeInTheDocument();
    expect(screen.getByText(".18")).toBeInTheDocument();
    expect(screen.getByText("Up £25.80 today. Side Bet needs a look.")).toBeInTheDocument();
  });

  it("shows the three pots by their names, never their ids, each linking to its detail", async () => {
    renderRoute("/", { session: WAQAR, api: api() });
    await screen.findByText("£11,430");

    for (const [name, id] of [
      ["Foundation", "Base"],
      ["Handpicked", "Medium"],
      ["Side Bet", "Degen"],
    ] as const) {
      const card = screen
        .getAllByRole("link")
        .find((link) => link.getAttribute("data-pot") === id)!;
      expect(card).toHaveAttribute("href", `/pots/${id}`);
      expect(within(card).getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText("Degen")).not.toBeInTheDocument();
  });

  it("fences Side Bet, and turns its breached cap red", async () => {
    renderRoute("/", { session: WAQAR, api: api() });
    await screen.findByText("£11,430");

    const sideBet = document.querySelector('[data-pot="Degen"]')!;
    expect(sideBet).toHaveClass("hatch", "border-acc");
    expect(within(sideBet as HTMLElement).getByText(/over cap/)).toHaveClass("text-dn");

    const foundation = document.querySelector('[data-pot="Base"]')!;
    expect(foundation).not.toHaveClass("hatch");
  });

  it("changes every number when the timeframe changes", async () => {
    const { fetchMock } = renderRoute("/", { session: WAQAR, api: api() });
    await screen.findByText("Up £25.80 today. Side Bet needs a look.");

    fireEvent.click(screen.getByRole("radio", { name: "This month" }));

    expect(
      await screen.findByText("Up £120.40 this month. Side Bet needs a look."),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "This month" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/portfolio?tf=month")).toBe(
      true,
    );
  });

  it("states the target in words, beside the split", async () => {
    renderRoute("/", { session: WAQAR, api: api() });

    expect(
      await screen.findByText("You asked for 70 / 25 / 5. You're at 72 / 21 / 7."),
    ).toBeInTheDocument();
  });

  it("names the price source on the provenance line — a market source, never a broker", async () => {
    renderRoute("/", { session: WAQAR, api: api() });

    const line = await screen.findByText("Sample prices · stub data · updated 4 min ago");
    expect(line.textContent).not.toMatch(/Trading 212|Kraken/);
  });

  it("lists what changed, and says when the list is done", async () => {
    renderRoute("/", { session: WAQAR, api: api() });

    expect(await screen.findByText("Side Bet crept 1.8% over its 5% cap")).toBeInTheDocument();
    expect(screen.getByText("That's the lot. Quiet week.")).toBeInTheDocument();
  });

  it("ends by saying Pip can't trade", async () => {
    renderRoute("/", { session: WAQAR, api: api() });
    expect(await screen.findByText(/Pip can look, not touch/)).toBeInTheDocument();
  });
});

describe("the pots screen's other states", () => {
  it("shows the numbers' shape while loading, not a spinner", async () => {
    const { container } = renderRoute("/", { session: WAQAR, api: api() });

    await waitFor(() =>
      expect(container.querySelector('[aria-busy="true"] [data-skeleton]')).toBeInTheDocument(),
    );
  });

  it("says what to do next when every pot is empty", async () => {
    renderRoute("/", {
      session: WAQAR,
      api: api({
        "/portfolio": {
          body: portfolio("day", {
            total: 0,
            buckets: [pot("Base", 0, 0, 70), pot("Medium", 0, 0, 25), pot("Degen", 0, 0, 5)],
          }),
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: /Three empty pots/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect an account" })).toHaveAttribute(
      "href",
      "/setup",
    );
  });

  it("reassures, and offers a retry, when the pots can't load", async () => {
    let calls = 0;
    renderRoute("/", {
      session: WAQAR,
      api: api({
        "/portfolio": () => {
          calls += 1;
          return calls === 1
            ? { status: 500, body: { error: "down" } }
            : { body: portfolio("day") };
        },
      }),
    });

    expect(
      await screen.findByText("Your money is fine — this is only the view of it."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("£11,430")).toBeInTheDocument();
  });
});

describe("the pots screen at other widths", () => {
  it("compresses pots to single rows on a tablet", async () => {
    setViewportWidth(TABLET_WIDTH);
    renderRoute("/", { session: WAQAR, api: api() });
    await screen.findByText("£11,430");

    expect(screen.queryByText("Base blurb")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-pot]")).toHaveLength(3);
  });

  it("lays the three pots side by side, and adds the shape you asked for, on desktop", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/", { session: WAQAR, api: api() });

    expect(
      await screen.findByRole("heading", { name: "The shape you asked for" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Base blurb")).toBeInTheDocument();
  });
});

describe("the staleness ladder on Pots", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
  function withFreshness(ages: Record<"Base" | "Medium" | "Degen", number>, failed = false) {
    return api({
      "/portfolio": {
        body: portfolio("day", {
          freshness: (["Base", "Medium", "Degen"] as const).map((bucket) => ({
            bucket,
            freshness: {
              source: "Sample prices · stub data",
              asOf: minutesAgo(ages[bucket]),
              failed: failed && bucket === "Degen",
              marketsClosed: false,
            },
          })),
        }),
      },
    });
  }

  it("goes amber with a chip on the late pot, leaving the total alone", async () => {
    const { container } = renderRoute("/", {
      session: WAQAR,
      api: withFreshness({ Base: 4, Medium: 4, Degen: 130 }),
    });

    expect(
      await screen.findByText("Side Bet is 2 hours old · everything else updated 4 min ago"),
    ).toHaveAttribute("data-state", "amber");
    const sideBet = container.querySelector('[data-pot="Degen"]')!;
    expect(within(sideBet as HTMLElement).getByText("2h old")).toBeInTheDocument();
    expect(container.querySelector('[data-pot="Base"]')).not.toHaveTextContent("old");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelector(".opacity-60")).not.toBeInTheDocument();
  });

  it("goes red when a feed fails: a card with a retry, the pot dimmed, the total marked rough", async () => {
    let calls = 0;
    const stale = withFreshness({ Base: 4, Medium: 4, Degen: 130 }, true);
    const fresh = withFreshness({ Base: 4, Medium: 4, Degen: 4 });
    const { container } = renderRoute("/", {
      session: WAQAR,
      api: {
        ...stale,
        "/portfolio": (init, url) => {
          calls += 1;
          const handler = calls === 1 ? stale["/portfolio"] : fresh["/portfolio"];
          return typeof handler === "function" ? handler(init, url) : handler!;
        },
      },
    });

    const card = await screen.findByRole("alert");
    expect(
      within(card).getByRole("heading", { name: "Side Bet isn't updating" }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent(
      "Your Side Bet number is from 2 hours ago. Everything else is live.",
    );
    expect(screen.getByText("Roughly — one pot is stale")).toBeInTheDocument();
    expect(screen.queryByText(/is 2 hours old/)).not.toBeInTheDocument();
    const sideBetValue = within(
      container.querySelector('[data-pot="Degen"]') as HTMLElement,
    ).getByText("£780");
    expect(sideBetValue).toHaveClass("opacity-60");

    fireEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Sample prices · stub data · updated 4 min ago"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

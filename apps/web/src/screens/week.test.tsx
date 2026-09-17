import type { NudgeView, WeekResponse, WeekView } from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute, type Handler } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth } from "../test/setup";

function nudge(overrides: Partial<NudgeView>): NudgeView {
  return {
    id: "n",
    cadence: "weekly",
    kind: "awareness",
    reason: "news",
    bucket: "Medium",
    instrumentId: "asml",
    title: "ASML in the news",
    body: "Reuters and the Financial Times reported on ASML this week.",
    basis: "Based on 2 sources over 1 day",
    sources: [
      {
        publisher: "Reuters",
        headline: "ASML examining ways to make more than 110 EUV tools",
        url: "https://news.example.test/asml/1",
        publishedAt: "2026-09-13T02:00:00Z",
      },
      {
        publisher: "Financial Times",
        headline: "ASML weighs bigger EUV run",
        url: "https://news.example.test/asml/2",
        publishedAt: "2026-09-13T06:00:00Z",
      },
    ],
    checks: [
      { rule: "Side Bet has room under its cap", passed: true, detail: "Not in Side Bet" },
      {
        rule: "Enough different publishers",
        passed: true,
        detail: "2 publishers: Financial Times, Reuters",
      },
    ],
    response: null,
    createdAt: "2026-09-14T08:00:00Z",
    ...overrides,
  };
}

const cap = nudge({
  id: "cap",
  kind: "shape",
  reason: "cap",
  bucket: "Degen",
  instrumentId: null,
  title: "Side Bet is £209 over its cap",
  body: "That's 1.8% past the line you set. You'd do either at your broker.",
  basis: null,
  sources: [],
  checks: [
    { rule: "Not on your exclusions list", passed: true, detail: "Not on your exclusions list" },
  ],
});

function week(overrides: Partial<WeekView> = {}): WeekView {
  return {
    weekOf: "2026-09-14",
    builtAt: "2026-09-14T08:00:00Z",
    opening: "Here's your week.",
    nudges: [cap, nudge({ id: "asml" })],
    heldBack: [
      nudge({
        id: "nvda",
        title: "Nvidia was in the news",
        basis: "Based on 1 source over 1 day",
        heldBackBecause: "Not enough different publishers — 1 publisher: CNBC",
        checks: [
          { rule: "Enough different publishers", passed: false, detail: "1 publisher: CNBC" },
        ],
      }),
    ],
    counts: { holdingsChecked: 9, reportsRead: 6, reportsCounted: 5 },
    next: { what: "Nvidia results", onDate: "2026-09-23" },
    ...overrides,
  };
}

function api(response: WeekResponse, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...ME_ALLOWED,
    "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
    "/week": { body: response },
    ...extra,
  };
}

beforeEach(() => setViewportWidth(PHONE_WIDTH));

describe("Your week", () => {
  it("shows each note with what it rests on and the rules it passed, under the not-advice label", async () => {
    renderRoute("/week", { session: WAQAR, api: api({ week: week(), today: [], pastWeeks: [] }) });

    expect(await screen.findByRole("heading", { name: "Your week" })).toBeInTheDocument();
    expect(screen.getByText("Week of 14 Sep")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "ASML in the news" }).closest("article")!;
    expect(within(card).getByText("Based on 2 sources over 1 day")).toBeInTheDocument();
    const reuters = within(card).getByRole("link", { name: /Reuters/ });
    expect(reuters).toHaveAttribute("href", "https://news.example.test/asml/1");
    expect(reuters).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      within(card).getByText(
        /Passed: Side Bet has room under its cap · Enough different publishers/,
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText("Information, not advice")).toBeInTheDocument();
    expect(screen.getByText("That's the lot.")).toBeInTheDocument();
    expect(screen.getByText(/Pip can look, not touch/)).toBeInTheDocument();
  });

  it("fences a Side Bet note like every Side Bet thing", async () => {
    renderRoute("/week", { session: WAQAR, api: api({ week: week(), today: [], pastWeeks: [] }) });
    const card = (
      await screen.findByRole("heading", { name: "Side Bet is £209 over its cap" })
    ).closest("article")!;
    expect(card.className).toMatch(/hatch/);
    expect(card.className).toMatch(/pot-bet/);
  });

  it("keeps what the trust rules held back one tap away, with the reason", async () => {
    renderRoute("/week", { session: WAQAR, api: api({ week: week(), today: [], pastWeeks: [] }) });
    const toggle = await screen.findByRole("button", {
      name: "1 thing didn't get past your trust rules",
    });
    expect(screen.queryByText("Nvidia was in the news")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("Nvidia was in the news")).toBeInTheDocument();
    expect(
      screen.getByText("Held back: Not enough different publishers — 1 publisher: CNBC"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide what was held back" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("reads a quiet week as a result, with its working", async () => {
    const quiet = nudge({
      id: "quiet",
      kind: "none",
      reason: "quiet",
      bucket: null,
      instrumentId: null,
      title: "Nothing needs you this week.",
      body: "Pip checked 4 holdings and read 14 news reports. Nothing got past your trust rules. Next on the calendar: Nvidia results, Wed 23 Sep.",
      basis: null,
      sources: [],
      checks: [],
    });
    renderRoute("/week", {
      session: WAQAR,
      api: api({ week: week({ nudges: [quiet], heldBack: [] }), today: [], pastWeeks: [] }),
    });
    expect(
      await screen.findByRole("heading", { name: "Nothing needs you this week." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Next on the calendar: Nvidia results/)).toBeInTheDocument();
    expect(screen.getByText("That's the lot. Quiet week.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "What did you do?" })).not.toBeInTheDocument();
    expect(screen.queryByText("Information, not advice")).not.toBeInTheDocument();
  });

  it("records what you did", async () => {
    let posted: unknown;
    const { fetchMock } = renderRoute("/week", {
      session: WAQAR,
      api: api(
        { week: week(), today: [], pastWeeks: [] },
        {
          "/nudges/asml/response": (init) => {
            posted = JSON.parse(String(init?.body));
            return { body: { id: "asml", response: "acted", respondedAt: "2026-09-14T09:00:00Z" } };
          },
        },
      ),
    });
    const card = (await screen.findByRole("heading", { name: "ASML in the news" })).closest(
      "article",
    )!;
    const group = within(card).getByRole("group", { name: "What did you do?" });
    fireEvent.click(within(group).getByRole("button", { name: "Acted" }));
    await waitFor(() => expect(posted).toEqual({ response: "acted" }));
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/api/nudges/asml/response")),
    ).toBe(true);
  });

  it("shows what you already marked", async () => {
    renderRoute("/week", {
      session: WAQAR,
      api: api({
        week: week({ nudges: [nudge({ id: "asml", response: "dismissed" })] }),
        today: [],
        pastWeeks: [],
      }),
    });
    expect(await screen.findByRole("button", { name: "Dismissed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Acted" })).toHaveAttribute("aria-pressed", "false");
  });

  it("puts today's daily notes first", async () => {
    renderRoute("/week", {
      session: WAQAR,
      api: api({
        week: week(),
        today: [
          nudge({
            id: "d1",
            cadence: "daily",
            kind: "calendar",
            reason: "earnings",
            title: "Nvidia reports results on Wed 23 Sep",
            sources: [],
            basis: null,
          }),
        ],
        pastWeeks: [],
      }),
    });
    const today = await screen.findByRole("region", { name: "Today" });
    expect(within(today).getByText("Nvidia reports results on Wed 23 Sep")).toBeInTheDocument();
  });

  it("says when the first week arrives", async () => {
    renderRoute("/week", { session: WAQAR, api: api({ week: null, today: [], pastWeeks: [] }) });
    expect(await screen.findByText(/Your first week arrives on Monday/)).toBeInTheDocument();
  });

  it("lists earlier weeks and opens one", async () => {
    renderRoute("/week", {
      session: WAQAR,
      api: api(
        { week: week(), today: [], pastWeeks: ["2026-09-07"] },
        {
          "/week/2026-09-07": {
            body: week({ weekOf: "2026-09-07", opening: "Last week's opening." }),
          },
        },
      ),
    });
    fireEvent.click(await screen.findByRole("link", { name: "Week of 7 Sep" }));
    expect(await screen.findByText("Last week's opening.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to this week/ })).toBeInTheDocument();
  });

  it("says there's no such week", async () => {
    renderRoute("/week/2020-01-06", {
      session: WAQAR,
      api: api(
        { week: null, today: [], pastWeeks: [] },
        { "/week/2020-01-06": { status: 404, body: { error: "no_such_week" } } },
      ),
    });
    expect(await screen.findByText(/There's no week from then/)).toBeInTheDocument();
  });

  it("says your money is fine when the week can't load, and retries", async () => {
    let calls = 0;
    renderRoute("/week", {
      session: WAQAR,
      api: {
        ...api({ week: week(), today: [], pastWeeks: [] }),
        "/week": () =>
          ++calls === 1
            ? { status: 500, body: {} }
            : { body: { week: week(), today: [], pastWeeks: [] } },
      },
    });
    expect(await screen.findByText("Can't load your week right now")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Week of 14 Sep")).toBeInTheDocument();
  });

  it("keeps Pots lit, at desktop width too", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/week", { session: WAQAR, api: api({ week: week(), today: [], pastWeeks: [] }) });
    await screen.findByText("Week of 14 Sep");
    const pots = screen
      .getAllByRole("link", { name: /Pots/ })
      .find((link) => link.getAttribute("aria-current") === "page");
    expect(pots).toBeDefined();
  });
});

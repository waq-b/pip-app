import { DEFAULT_TRUST_SETTINGS } from "@finance-app/shared";
import type { RulesView } from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute, type Handler } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth } from "../test/setup";

function view(overLimit = true): RulesView {
  return {
    rules: [
      {
        bucket: "Base",
        kind: "target",
        targetPercent: 75,
        actualPercent: 72,
        plain: "It's 2% over target, which is nothing to worry about.",
      },
      {
        bucket: "Medium",
        kind: "target",
        targetPercent: 25,
        actualPercent: 21,
        plain: "A bit under target.",
      },
      {
        bucket: "Degen",
        kind: "cap",
        targetPercent: 0,
        actualPercent: 6.8,
        status: overLimit ? "over_limit" : "ok",
        plain: overLimit
          ? "Side Bet has reached the £350 starter limit: you've put in £400 over the last year."
          : "Side Bet is £200 of the £350 starter limit, counting money in less what you've taken out over the last year.",
        limit: {
          limit: 35_000,
          moneyIn: overLimit ? 40_000 : 20_000,
          value: 78_000,
          usedPercent: overLimit ? 114.29 : 57.14,
          starter: true,
          grownBy: overLimit ? 38_000 : 58_000,
        },
        ...(overLimit ? { overBy: { percent: 14.29, amount: 5_000 } } : {}),
      },
    ],
    monthlySplit: {
      total: 20_000,
      perBucket: [
        { bucket: "Base", amount: 14_000, percent: 70 },
        { bucket: "Medium", amount: 5_000, percent: 25 },
        { bucket: "Degen", amount: 1_000, percent: 5 },
      ],
    },
  };
}

function api(rules: Handler = { body: view() }): Record<string, Handler> {
  return {
    ...ME_ALLOWED,
    "/rules": rules,
    "/trust-rules": { body: { settings: DEFAULT_TRUST_SETTINGS } },
  };
}

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
});

describe("the rules screen", () => {
  it("shows each pot's line — targets for two, a limit in pounds for Side Bet", async () => {
    renderRoute("/rules", { session: WAQAR, api: api() });

    expect(
      await screen.findByRole("heading", { name: "Your rules", level: 1 }),
    ).toBeInTheDocument();

    const foundation = (await screen.findByRole("heading", { name: "Foundation" })).closest(
      "section",
    )!;
    expect(within(foundation).getAllByText("Target").length).toBeGreaterThan(0);
    expect(within(foundation).getByText("75%")).toBeInTheDocument();

    const sideBet = screen.getByRole("heading", { name: "Side Bet" }).closest("section")!;
    expect(within(sideBet).getAllByText("Limit").length).toBeGreaterThan(0);
    // Its line is pounds, not a percentage, and there's no slider to set it.
    expect(within(sideBet).getByText("£350")).toBeInTheDocument();
    expect(within(sideBet).queryByRole("slider")).not.toBeInTheDocument();
    expect(sideBet).toHaveClass("hatch", "border-acc");
  });

  it("states a reached limit in pounds first, and marks it as information, not advice", async () => {
    renderRoute("/rules", { session: WAQAR, api: api() });

    const banner = await screen.findByRole("alert");
    expect(
      within(banner).getByRole("heading", { name: "Side Bet has reached its starter limit" }),
    ).toBeInTheDocument();
    expect(banner).toHaveTextContent("You've put in £400 over the last year");
    expect(banner).toHaveTextContent("Pip can't stop anything");
    expect(within(banner).getByText(/information, not advice/i)).toBeInTheDocument();
  });

  it("says the limit is a starter until net assets are given", async () => {
    renderRoute("/rules", { session: WAQAR, api: api() });
    const sideBet = (await screen.findByRole("heading", { name: "Side Bet" })).closest("section")!;
    expect(
      within(sideBet).getByText(/Starter limit — add your net assets in Setup/),
    ).toBeInTheDocument();
  });

  it("offers nothing that acts on money — only rules to change, and sums to read", async () => {
    renderRoute("/rules", {
      session: WAQAR,
      api: api({
        body: {
          ...view(),
          settings: { handpickedTarget: 25 },
          needsAttention: true,
          fixIt: { outOfSideBet: 5_000 },
        },
      }),
    });
    await screen.findByRole("alert");

    const names = screen.queryAllByRole("button").map((button) => button.textContent ?? "");
    expect(names.join(" | ")).not.toMatch(/buy|sell|move|transfer|withdraw|order|rebalance/i);
  });

  it("shows no banner when every pot is inside its line", async () => {
    renderRoute("/rules", { session: WAQAR, api: api({ body: view(false) }) });

    await screen.findByRole("heading", { name: "Side Bet" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("describes the monthly split as the user's own, in pounds", async () => {
    renderRoute("/rules", { session: WAQAR, api: api() });

    expect(
      await screen.findByText(/Pip reads the split — it doesn't make it\./),
    ).toBeInTheDocument();
    for (const amount of ["£140", "£50", "£10"]) {
      expect(screen.getByText(amount)).toBeInTheDocument();
    }
  });

  it("never implies Pip moves money", async () => {
    const { container } = renderRoute("/rules", { session: WAQAR, api: api() });
    await screen.findByRole("alert");

    expect(container.textContent).not.toMatch(
      /Pip (has stopped|will nudge|stopped topping|split automatically)/i,
    );
    expect(
      screen.getByText("Changing a rule changes what Pip tells you — it never moves your money."),
    ).toBeInTheDocument();
  });
});

describe("the rules screen's other states", () => {
  it("shows the shape while loading", async () => {
    const { container } = renderRoute("/rules", { session: WAQAR, api: api() });

    await waitFor(() =>
      expect(container.querySelector('[aria-busy="true"] [data-skeleton]')).toBeInTheDocument(),
    );
  });

  it("offers a retry when the rules can't load", async () => {
    let calls = 0;
    renderRoute("/rules", {
      session: WAQAR,
      api: api(() => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "down" } } : { body: view() };
      }),
    });

    expect(
      await screen.findByRole("heading", { name: "Can't load your rules right now" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Side Bet has reached its starter limit" }),
    ).toBeInTheDocument();
  });

  it("lays the three rules side by side on desktop", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/rules", { session: WAQAR, api: api() });

    const foundation = (await screen.findByRole("heading", { name: "Foundation" })).closest(
      "section",
    )!;
    expect(foundation.parentElement).toHaveClass("grid-cols-3");
  });
});

describe("the red dot on Rules", () => {
  it("lights up in the navigation when Side Bet has reached its limit, on any screen", async () => {
    renderRoute("/", { session: WAQAR, api: api() });

    expect(await screen.findByRole("status", { name: "A rule needs a look" })).toBeInTheDocument();
  });

  it("stays dark when every pot is inside its line", async () => {
    const { fetchMock } = renderRoute("/", { session: WAQAR, api: api({ body: view(false) }) });

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/rules")).toBe(true),
    );
    await screen.findByRole("navigation", { name: "Sections" });
    expect(screen.queryByRole("status", { name: "A rule needs a look" })).not.toBeInTheDocument();
  });
});

describe("changing your rules", () => {
  function editable(overrides: Partial<RulesView> = {}): RulesView {
    return {
      ...view(false),
      settings: { handpickedTarget: 25 },
      needsAttention: false,
      leftOut: [],
      ...overrides,
    };
  }

  function withSaving(initial: RulesView, respond: (body: unknown) => { status?: number }) {
    const sent: unknown[] = [];
    renderRoute("/rules", {
      session: WAQAR,
      api: {
        ...ME_ALLOWED,
        "/rules": (init) => {
          if (init?.method === "PUT") {
            const body = JSON.parse(String(init.body));
            sent.push(body);
            const { status = 200 } = respond(body);
            return {
              status,
              body: status === 200 ? { settings: body } : { error: "target_out_of_range" },
            };
          }
          return { body: initial };
        },
      },
    });
    return sent;
  }

  it("moves the slider freely and saves nothing until Save — then once", async () => {
    const sent = withSaving(editable(), () => ({}));
    const target = await screen.findByRole("slider", { name: "Handpicked's target" });
    fireEvent.change(target, { target: { value: "26" } });
    fireEvent.change(target, { target: { value: "30" } });
    // The numbers follow at once; Foundation is 100 − 30.
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(sent).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(sent).toEqual([{ handpickedTarget: 30 }]));
  });

  it("shows no Save until something has changed", async () => {
    const sent = withSaving(editable(), () => ({}));
    const target = await screen.findByRole("slider", { name: "Handpicked's target" });
    expect(screen.queryByRole("button", { name: "Save rules" })).not.toBeInTheDocument();

    fireEvent.change(target, { target: { value: "32" } });
    expect(
      screen.getByText("You've changed your rules. Nothing is saved until you save."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save rules" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it("says Foundation takes whatever's left, and lights its number when the slider changes it", async () => {
    withSaving(editable(), () => ({}));
    const target = await screen.findByRole("slider", { name: "Handpicked's target" });
    expect(screen.getByText("75%")).not.toHaveAttribute("data-changed");

    fireEvent.change(target, { target: { value: "35" } });
    expect(screen.getByText("65%")).toHaveAttribute("data-changed", "true");
    await waitFor(() => expect(screen.getByText("65%")).not.toHaveAttribute("data-changed"), {
      timeout: 2000,
    });
  });

  it("gives Foundation no slider — it's the rest — and Side Bet none at all", async () => {
    withSaving(editable(), () => ({}));
    expect(await screen.findByText("The rest, after Handpicked")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(screen.queryByRole("slider", { name: /Foundation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: /Side Bet/ })).not.toBeInTheDocument();
  });

  it("lets Handpicked take all of it, or none", async () => {
    withSaving(editable(), () => ({}));
    const target = await screen.findByRole("slider", { name: "Handpicked's target" });
    expect(target).toHaveAttribute("max", "100");
    fireEvent.change(target, { target: { value: "100" } });
    expect(target).toHaveValue("100");
    // Foundation is left with nothing, which is allowed.
    const foundation = screen.getByRole("heading", { name: "Foundation" }).closest("section")!;
    expect(within(foundation).getByText("0%")).toBeInTheDocument();
  });

  it("says a failed save changed nothing", async () => {
    withSaving(editable(), () => ({ status: 400 }));
    fireEvent.change(await screen.findByRole("slider", { name: "Handpicked's target" }), {
      target: { value: "31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    expect(
      await screen.findByText("Couldn't save that. Your rules haven't changed — try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save rules" })).toBeEnabled();
  });

  it("says when targets are judged without a pot that isn't connected", async () => {
    withSaving(editable({ leftOut: ["Medium"] }), () => ({}));
    expect(
      await screen.findByText(
        /Handpicked isn't connected, so your targets are judged against the pots Pip can see/,
      ),
    ).toBeInTheDocument();
  });

  it("says when the rules last changed", async () => {
    withSaving(editable({ lastChangedAt: "2026-09-02T10:00:00Z" }), () => ({}));
    expect(await screen.findByText("Last changed 2 Sep")).toBeInTheDocument();
  });
});

describe("Side Bet past its limit", () => {
  function broken(fixIt: RulesView["fixIt"] = { outOfSideBet: 5_000 }) {
    return {
      ...view(),
      settings: { handpickedTarget: 25 },
      needsAttention: true,
      leftOut: [],
      fixIt,
    } satisfies RulesView;
  }

  it("shows the one amount that would bring it back, as information", async () => {
    renderRoute("/rules", { session: WAQAR, api: api({ body: broken() }) });
    const toggle = await screen.findByRole("button", { name: "Show me how to fix it" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    const panel = screen.getByRole("region", {
      name: "What would bring it back under its limit",
    });
    expect(within(panel).getByText("£50")).toBeInTheDocument();
    expect(within(panel).getByText("taken out of Side Bet")).toBeInTheDocument();
    expect(panel).toHaveTextContent("You'd do that at your broker.");
    expect(panel).not.toHaveTextContent(/should|recommend|best|better/i);
    expect(
      within(screen.getByRole("alert")).getByText(/information, not advice/i),
    ).toBeInTheDocument();
  });

  it("never offers to raise the limit — it follows your net assets, not a slider", async () => {
    renderRoute("/rules", { session: WAQAR, api: api({ body: broken() }) });
    await screen.findByRole("alert");
    const names = screen.queryAllByRole("button").map((button) => button.textContent ?? "");
    expect(names.join(" | ")).not.toMatch(/raise|cap/i);
  });

  it("goes red from the engine's answer, not the rounded percentages", async () => {
    const edge: RulesView = {
      ...broken(),
      rules: view().rules.map((rule) =>
        rule.bucket === "Degen"
          ? { ...rule, status: "over_limit", overBy: { percent: 0, amount: 1 } }
          : rule,
      ),
    };
    renderRoute("/rules", { session: WAQAR, api: api({ body: edge }) });
    await screen.findByRole("heading", { name: "Side Bet" });
    const meters = screen.getAllByRole("meter");
    expect(meters.some((meter) => meter.getAttribute("data-over") === "true")).toBe(true);
  });
});

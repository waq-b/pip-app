import type { RulesView } from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute, type Handler } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth } from "../test/setup";

function view(overCap = true): RulesView {
  return {
    rules: [
      {
        bucket: "Base",
        kind: "target",
        targetPercent: 70,
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
        targetPercent: 5,
        actualPercent: overCap ? 6.8 : 4,
        plain: overCap
          ? "Over the line you set. Nothing new has gone in since June."
          : "Comfortably inside.",
        ...(overCap ? { overBy: { percent: 1.8, amount: 20_800 } } : {}),
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
  return { ...ME_ALLOWED, "/rules": rules };
}

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
});

describe("the rules screen", () => {
  it("shows each pot's line — targets for two, a hard cap for Side Bet", async () => {
    renderRoute("/rules", { session: WAQAR, api: api() });

    expect(
      await screen.findByRole("heading", { name: "Your rules", level: 1 }),
    ).toBeInTheDocument();

    const foundation = (await screen.findByRole("heading", { name: "Foundation" })).closest(
      "section",
    )!;
    expect(within(foundation).getAllByText("Target").length).toBeGreaterThan(0);
    expect(within(foundation).getByText("70%")).toBeInTheDocument();

    const sideBet = screen.getByRole("heading", { name: "Side Bet" }).closest("section")!;
    expect(within(sideBet).getAllByText("Hard cap").length).toBeGreaterThan(0);
    expect(sideBet).toHaveClass("hatch", "border-acc");
  });

  it("states a breached cap in pounds first, and marks it as information, not advice", async () => {
    renderRoute("/rules", { session: WAQAR, api: api() });

    const banner = await screen.findByRole("alert");
    expect(
      within(banner).getByRole("heading", { name: "Side Bet is £208 over its cap" }),
    ).toBeInTheDocument();
    expect(banner).toHaveTextContent("grown to 6.8% of your money, against the 5% you set");
    expect(within(banner).getByText(/information, not advice/i)).toBeInTheDocument();
  });

  it("offers no way to change anything or act on it — that's Phase 4, and the broker's job", async () => {
    renderRoute("/rules", { session: WAQAR, api: api() });
    await screen.findByRole("alert");

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText(/raise the cap|show me how to fix it/i)).not.toBeInTheDocument();
    expect(screen.queryByText("+")).not.toBeInTheDocument();
    expect(screen.queryByText("−")).not.toBeInTheDocument();
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
      await screen.findByRole("heading", { name: "Side Bet is £208 over its cap" }),
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
  it("lights up in the navigation when a cap is breached, on any screen", async () => {
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

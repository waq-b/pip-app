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

describe("changing your rules", () => {
  function editable(overrides: Partial<RulesView> = {}): RulesView {
    return {
      ...view(false),
      settings: { handpickedTarget: 25, sideBetCap: 5 },
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
              body: status === 200 ? { settings: body } : { error: "cap_out_of_range" },
            };
          }
          return { body: initial };
        },
      },
    });
    return sent;
  }

  it("steps Handpicked's target and Side Bet's cap, saving each change", async () => {
    const sent = withSaving(editable(), () => ({}));
    fireEvent.click(await screen.findByRole("button", { name: "Raise Handpicked's target" }));
    await waitFor(() => expect(sent).toEqual([{ handpickedTarget: 26, sideBetCap: 5 }]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Lower Side Bet's cap" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Lower Side Bet's cap" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ handpickedTarget: 25, sideBetCap: 4 });
  });

  it("gives Foundation no stepper — it's the rest", async () => {
    withSaving(editable(), () => ({}));
    expect(await screen.findByText("The rest, after Handpicked and Side Bet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Foundation/ })).not.toBeInTheDocument();
  });

  it("stops the cap stepper at 20%", async () => {
    withSaving(editable({ settings: { handpickedTarget: 25, sideBetCap: 20 } }), () => ({}));
    expect(await screen.findByRole("button", { name: "Raise Side Bet's cap" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Lower Side Bet's cap" })).toBeEnabled();
  });

  it("notes the FCA restricted-investor assumption above a 10% cap, without blocking", async () => {
    withSaving(editable({ settings: { handpickedTarget: 25, sideBetCap: 11 } }), () => ({}));
    expect(
      await screen.findByText("Above the 10% the FCA restricted-investor rules assume."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raise Side Bet's cap" })).toBeEnabled();
  });

  it("doesn't note it at 10% or below", async () => {
    withSaving(editable({ settings: { handpickedTarget: 25, sideBetCap: 10 } }), () => ({}));
    await screen.findByRole("button", { name: "Raise Side Bet's cap" });
    expect(screen.queryByText(/FCA restricted-investor/)).not.toBeInTheDocument();
  });

  it("says a failed save changed nothing, and keeps showing the saved rules", async () => {
    withSaving(editable(), () => ({ status: 400 }));
    fireEvent.click(await screen.findByRole("button", { name: "Raise Side Bet's cap" }));
    expect(
      await screen.findByText("Couldn't save that. Your rules haven't changed — try again."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("5%").length).toBeGreaterThan(0);
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

import { DEFAULT_TRUST_SETTINGS, EMPTY_PROFILE, type TrustSettings } from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute, type Handler } from "../test/render-route";
import { PHONE_WIDTH, setViewportWidth } from "../test/setup";

beforeEach(() => setViewportWidth(PHONE_WIDTH));

const noRules = { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } };

function rulesApi(trust: Handler): Record<string, Handler> {
  return { ...ME_ALLOWED, "/rules": noRules, "/trust-rules": trust };
}

describe("What Pip lets through, on Rules", () => {
  it("shows the trust rules in plain words", async () => {
    renderRoute("/rules", {
      session: WAQAR,
      api: rulesApi({ body: { settings: DEFAULT_TRUST_SETTINGS } }),
    });
    const section = (await screen.findByRole("heading", { name: "What Pip lets through" })).closest(
      "section",
    )!;
    expect(await within(section).findByText("The last 7 days")).toBeInTheDocument();
    expect(within(section).getByText("At least 2")).toBeInTheDocument();
    expect(within(section).getByText("3 days either side")).toBeInTheDocument();
    expect(within(section).getByLabelText("A big one-day move in Side Bet")).toHaveValue("15");
    expect(within(section).getByText("reuters.com")).toBeInTheDocument();
    expect(
      within(section).getByText(/Always on: nothing about a Side Bet holding/),
    ).toBeInTheDocument();
    expect(
      within(section).queryByRole("button", { name: "Save trust rules" }),
    ).not.toBeInTheDocument();
  });

  it("saves once, with a slider moved, a publisher added and one removed", async () => {
    let sent: TrustSettings | undefined;
    renderRoute("/rules", {
      session: WAQAR,
      api: rulesApi((init) => {
        if (init?.method === "PUT") {
          sent = JSON.parse(String(init.body)) as TrustSettings;
          return { body: { settings: sent, lastChangedAt: "2026-09-17T10:00:00Z" } };
        }
        return { body: { settings: DEFAULT_TRUST_SETTINGS } };
      }),
    });
    fireEvent.change(await screen.findByLabelText("Different publishers needed"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Add a publisher"), {
      target: { value: "https://www.Economist.com/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove bbc.com" }));
    expect(
      screen.getByText("You've changed what Pip lets through. Nothing is saved until you save."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save trust rules" }));
    await waitFor(() => expect(sent).toBeDefined());
    expect(sent!.minSources).toBe(3);
    expect(sent!.namedPublishers).toContain("economist.com");
    expect(sent!.namedPublishers).not.toContain("bbc.com");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save trust rules" })).not.toBeInTheDocument(),
    );
  });

  it("won't add something that isn't a website", async () => {
    renderRoute("/rules", {
      session: WAQAR,
      api: rulesApi({ body: { settings: DEFAULT_TRUST_SETTINGS } }),
    });
    fireEvent.change(await screen.findByLabelText("Add a publisher"), {
      target: { value: "Reuters" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText(/doesn't look like a website address/)).toBeInTheDocument();
  });

  it("says nothing changed when a save fails", async () => {
    renderRoute("/rules", {
      session: WAQAR,
      api: rulesApi((init) =>
        init?.method === "PUT"
          ? { status: 500, body: {} }
          : { body: { settings: DEFAULT_TRUST_SETTINGS } },
      ),
    });
    fireEvent.change(await screen.findByLabelText("News and big-move notes a week"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save trust rules" }));
    expect(
      await screen.findByText("Couldn't save that. Your trust rules haven't changed — try again."),
    ).toBeInTheDocument();
  });
});

function setupApi(profile: Handler): Record<string, Handler> {
  return { ...ME_ALLOWED, "/rules": noRules, "/connections": { body: [] }, "/profile": profile };
}

describe("Your plan, on Setup", () => {
  it("says notes stay general until personal research is on", async () => {
    renderRoute("/setup", {
      session: WAQAR,
      api: setupApi({ body: { profile: EMPTY_PROFILE, personalised: false } }),
    });
    expect(await screen.findByText(/Pip keeps its notes general for now/)).toBeInTheDocument();
  });

  it("saves goals, horizon, pounds a month, risk words and exclusions", async () => {
    let sent: unknown;
    renderRoute("/setup", {
      session: WAQAR,
      api: setupApi((init) => {
        if (init?.method === "PUT") {
          sent = JSON.parse(String(init.body));
          return { body: { profile: sent, personalised: true } };
        }
        return { body: { profile: EMPTY_PROFILE, personalised: true } };
      }),
    });
    fireEvent.change(await screen.findByLabelText("What you're investing for"), {
      target: { value: "Grow savings" },
    });
    expect(screen.queryByText(/keeps its notes general/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("For how many years"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Money in each month"), {
      target: { value: "£500.50" },
    });
    fireEvent.change(screen.getByLabelText("How you feel about risk, in your words"), {
      target: { value: "Ride the dips" },
    });
    const exclusion = screen.getByLabelText("Never nudge me about");
    fireEvent.change(exclusion, { target: { value: "Tobacco" } });
    fireEvent.keyDown(exclusion, { key: "Enter" });
    expect(screen.getByText("12 / 280")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() =>
      expect(sent).toEqual({
        goals: "Grow savings",
        horizonYears: 15,
        monthlyInPence: 50_050,
        riskWords: "Ride the dips",
        exclusions: ["Tobacco"],
      }),
    );
  });

  it("won't save pounds that aren't a number", async () => {
    renderRoute("/setup", {
      session: WAQAR,
      api: setupApi({ body: { profile: EMPTY_PROFILE, personalised: true } }),
    });
    fireEvent.change(await screen.findByLabelText("Money in each month"), {
      target: { value: "lots" },
    });
    expect(screen.getByText("Pounds, like 500 or 500.50.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save plan" })).not.toBeInTheDocument();
  });
});

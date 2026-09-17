import { EMPTY_PROFILE } from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute, type Handler } from "../test/render-route";

/**
 * Net assets on Setup (DESIGN §11.3). The figure is the most sensitive thing
 * Pip holds, so the screen's job is to keep it — and the limit it sets — behind
 * dots until someone asks outright.
 */

const UNSET = { set: false, starterLimit: true, dueReview: false };
const SET = {
  set: true,
  starterLimit: false,
  reviewedAt: "2026-09-12T09:00:00Z",
  dueReview: false,
};

function api(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...ME_ALLOWED,
    "/connections": { body: [] },
    "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
    "/profile": { body: { profile: EMPTY_PROFILE, personalised: false } },
    "/net-assets": { body: UNSET },
    ...overrides,
  };
}

const setupScreen = (overrides: Record<string, Handler> = {}) =>
  renderRoute("/setup", { session: WAQAR, api: api(overrides) });

const row = async () =>
  (await screen.findByRole("heading", { name: "Net assets" })).closest("section")!;

describe("the net assets row", () => {
  it("says it isn't set, and what Side Bet is held to meanwhile", async () => {
    setupScreen();
    const section = await row();

    expect(within(section).getByText("NOT SET")).toBeInTheDocument();
    expect(section).toHaveTextContent("flat £350 limit");
    expect(within(section).getByRole("button", { name: "Add my net assets" })).toBeInTheDocument();
  });

  it("keeps the figure behind dots until the eye is tapped, and asks the server only then", async () => {
    const calls: string[] = [];
    setupScreen({
      "/net-assets": { body: SET },
      "/net-assets/reveal": (init) => {
        calls.push(String(init?.method));
        return { body: { ...SET, pounds: 64_000, limit: 640_000 } };
      },
    });
    const section = await row();

    expect(within(section).getByText("••••••")).toBeInTheDocument();
    expect(section).not.toHaveTextContent("64,000");
    expect(calls).toEqual([]);

    fireEvent.click(within(section).getByRole("button", { name: "Show net assets" }));

    expect(await within(section).findByText("64,000")).toBeInTheDocument();
    expect(calls).toEqual(["POST"]);
    // The limit gives the figure away ten times over, so it waits for the eye too.
    expect(section).toHaveTextContent("£6,400");
  });

  it("hides it again on a second tap", async () => {
    setupScreen({
      "/net-assets": { body: SET },
      "/net-assets/reveal": { body: { ...SET, pounds: 64_000, limit: 640_000 } },
    });
    const section = await row();
    fireEvent.click(within(section).getByRole("button", { name: "Show net assets" }));
    await within(section).findByText("64,000");

    fireEvent.click(within(section).getByRole("button", { name: "Hide net assets" }));
    expect(within(section).getByText("••••••")).toBeInTheDocument();
    expect(section).not.toHaveTextContent("£6,400");
  });

  it("says when it was last reviewed, and asks for a check after a year", async () => {
    setupScreen({ "/net-assets": { body: { ...SET, dueReview: true } } });
    const section = await row();

    expect(section).toHaveTextContent("Last reviewed 12 Sep");
    expect(section).toHaveTextContent("It's been a year. Worth checking it still looks right.");
  });

  it("takes a figure with the keypad or the steppers, and sends whole pounds", async () => {
    const sent: unknown[] = [];
    setupScreen({
      "/net-assets": (init) => {
        if (init?.method === "PUT") {
          sent.push(JSON.parse(String(init.body)));
          return { body: { set: true, starterLimit: false, pounds: 70_000, limit: 700_000 } };
        }
        return { body: UNSET };
      },
    });
    const section = await row();
    fireEvent.click(within(section).getByRole("button", { name: "Add my net assets" }));

    const field = await within(section).findByLabelText("Net assets in pounds");
    // A pasted "£65,000" is still a number.
    fireEvent.change(field, { target: { value: "£65,000" } });
    fireEvent.click(within(section).getByRole("button", { name: "Up £5,000" }));
    expect(field).toHaveValue("70,000");

    fireEvent.click(within(section).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([{ pounds: 70_000 }]));
  });

  it("never offers to do anything with the money", async () => {
    setupScreen({ "/net-assets": { body: SET } });
    const section = await row();

    expect(section).toHaveTextContent("Pip can't stop a purchase");
    expect(section).toHaveTextContent("only counts Side Bet");
    const buttons = within(section)
      .queryAllByRole("button")
      .map((button) => button.textContent ?? "");
    expect(buttons.join(" | ")).not.toMatch(/buy|sell|move|transfer|withdraw/i);
  });
});

describe("the first-login question", () => {
  const potSummary = (bucket: "Base" | "Medium" | "Degen", value: number, share: number) => ({
    bucket,
    value,
    change: { amount: 1_140, percent: 0.14, direction: "up" as const },
    blurb: "",
    shareOfTotal: share,
    targetPercent: 75,
    series: [{ at: "2026-09-15T00:00:00Z", value: 110 }],
  });

  const potsApi = (netAssets: Handler) => ({
    ...ME_ALLOWED,
    "/net-assets": netAssets,
    "/portfolio": {
      body: {
        timeframe: "day" as const,
        total: 1_143_018,
        change: { amount: 2_580, percent: 0.23, direction: "up" as const },
        verdict: "Up £25.80 today. Nothing needs you.",
        buckets: [potSummary("Base", 824_000, 72), potSummary("Medium", 241_000, 21)],
        freshness: (["Base", "Medium"] as const).map((bucket) => ({
          bucket,
          freshness: {
            source: "Sample prices · stub data",
            asOf: new Date().toISOString(),
            failed: false,
            marketsClosed: false,
          },
        })),
      },
    },
    "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
    "/week": {
      body: {
        week: {
          weekOf: "2026-09-14",
          opening: "Nothing needs you this week.",
          builtAt: "2026-09-14T07:05:00Z",
          nudges: [],
          heldBack: [],
          counts: { holdingsChecked: 1, reportsRead: 0, reportsCounted: 0 },
          next: null,
        },
        today: [],
        pastWeeks: [],
      },
    },
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("asks once Pip has something to show, and says what skipping costs", async () => {
    renderRoute("/", { session: WAQAR, api: potsApi({ body: UNSET }) });

    const ask = (await screen.findByRole("region", { name: "Your net assets" })) as HTMLElement;
    expect(within(ask).getByText("First login · step 2 of 2")).toBeInTheDocument();
    expect(ask).toHaveTextContent("Roughly, what are you worth all in?");
    expect(ask).toHaveTextContent("£350 starter limit");
    expect(ask).toHaveTextContent("never appears on the home screen");
  });

  it("doesn't ask someone who has already given them", async () => {
    renderRoute("/", { session: WAQAR, api: potsApi({ body: SET }) });
    await screen.findByRole("heading", { name: "Your pots" });
    expect(screen.queryByRole("region", { name: "Your net assets" })).not.toBeInTheDocument();
  });

  it("takes 'I'd rather not say' for an answer, and doesn't ask that device again", async () => {
    const { unmount } = renderRoute("/", { session: WAQAR, api: potsApi({ body: UNSET }) });
    const ask = await screen.findByRole("region", { name: "Your net assets" });

    fireEvent.click(within(ask).getByRole("button", { name: "I'd rather not say" }));
    expect(screen.queryByRole("region", { name: "Your net assets" })).not.toBeInTheDocument();

    unmount();
    renderRoute("/", { session: WAQAR, api: potsApi({ body: UNSET }) });
    await screen.findByRole("heading", { name: "Your pots" });
    expect(screen.queryByRole("region", { name: "Your net assets" })).not.toBeInTheDocument();
  });

  it("shows the limit the figure buys before it's saved", async () => {
    renderRoute("/", { session: WAQAR, api: potsApi({ body: UNSET }) });
    const ask = await screen.findByRole("region", { name: "Your net assets" });

    fireEvent.change(within(ask).getByLabelText("Net assets in pounds"), {
      target: { value: "64000" },
    });
    expect(within(ask).getByText("Your Side Bet limit")).toBeInTheDocument();
    expect(within(ask).getByText("£6,400")).toBeInTheDocument();
  });
});

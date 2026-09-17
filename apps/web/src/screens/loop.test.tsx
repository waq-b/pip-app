import {
  DEFAULT_TRUST_SETTINGS,
  type NudgeView,
  type TrustSettings,
  type WeekResponse,
} from "@finance-app/shared";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute } from "../test/render-route";
import { PHONE_WIDTH, setViewportWidth } from "../test/setup";

/**
 * The loop on screen (Phase 5 task 11): the planted ASML story is on Your
 * week; one trust rule is changed and saved on Rules; back on Your week it's
 * gone, held back with its reason. The API does the deciding — proven in
 * `apps/api/src/nudges/loop.test.ts`; this proves the screens ask again and
 * show what it says.
 */

const note = (overrides: Partial<NudgeView>): NudgeView => ({
  id: "n",
  cadence: "weekly",
  kind: "awareness",
  reason: "news",
  bucket: "Medium",
  instrumentId: "asml",
  title: "ASML in the news",
  body: "Sample words from stub mode: Financial Times and Reuters reported on ASML this week.",
  basis: "Based on 2 sources over 1 day",
  sources: [],
  checks: [
    {
      rule: "Enough different publishers",
      passed: true,
      detail: "2 publishers: Financial Times, Reuters",
    },
  ],
  response: null,
  createdAt: "2026-09-14T08:00:00Z",
  ...overrides,
});

const cap = note({
  id: "cap",
  kind: "shape",
  reason: "cap",
  bucket: "Degen",
  instrumentId: null,
  title: "Side Bet is £209 over its cap",
  basis: null,
  checks: [],
});
const asml = note({ id: "asml" });

beforeEach(() => setViewportWidth(PHONE_WIDTH));

describe("the loop, on screen", () => {
  it("shows the planted story, then hides it once a stricter trust rule is saved", async () => {
    let settings: TrustSettings = structuredClone(DEFAULT_TRUST_SETTINGS);
    const week = (): WeekResponse => ({
      week: {
        weekOf: "2026-09-14",
        builtAt: "2026-09-14T08:00:00Z",
        opening: "Here's your week, from stub mode.",
        nudges: settings.minSources >= 3 ? [cap] : [cap, asml],
        heldBack:
          settings.minSources >= 3
            ? [
                {
                  ...asml,
                  heldBackBecause:
                    "Not enough different publishers — 2 publishers: Financial Times, Reuters",
                },
              ]
            : [],
        counts: { holdingsChecked: 9, reportsRead: 6, reportsCounted: 5 },
        next: null,
      },
      today: [],
      pastWeeks: [],
    });

    const { router } = renderRoute("/week", {
      session: WAQAR,
      api: {
        ...ME_ALLOWED,
        "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
        "/week": () => ({ body: week() }),
        "/trust-rules": (init) => {
          if (init?.method === "PUT") settings = JSON.parse(String(init.body)) as TrustSettings;
          return { body: { settings } };
        },
      },
    });

    expect(await screen.findByRole("heading", { name: "ASML in the news" })).toBeInTheDocument();

    await router.navigate("/rules");
    fireEvent.change(await screen.findByLabelText("Different publishers needed"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save trust rules" }));
    await waitFor(() => expect(settings.minSources).toBe(3));

    await router.navigate("/week");
    const toggle = await screen.findByRole("button", {
      name: "1 thing didn't get past your trust rules",
    });
    expect(screen.queryByRole("heading", { name: "ASML in the news" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Side Bet is £209 over its cap" }),
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(
      screen.getByText(
        "Held back: Not enough different publishers — 2 publishers: Financial Times, Reuters",
      ),
    ).toBeInTheDocument();
  });
});

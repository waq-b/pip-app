import { EMPTY_PROFILE } from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import {
  ME_ALLOWED,
  NOTIFICATIONS_ANSWERED,
  renderRoute,
  type Handler,
} from "../test/render-route";

/**
 * Setup → Notifications (DESIGN §10.4): the masters the bell shows, the
 * per-kind switches under Push alerts, this device, where the email goes,
 * and when Pip last checked.
 */

function setup(overrides: Record<string, Handler> = {}, personalised = true) {
  return renderRoute("/setup", {
    session: WAQAR,
    api: {
      ...ME_ALLOWED,
      "/connections": { body: [] },
      "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
      "/profile": { body: { profile: EMPTY_PROFILE, personalised } },
      ...overrides,
    },
  });
}

const card = () => screen.findByRole("region", { name: "Notifications" });

describe("Setup's notifications", () => {
  it("has the three kinds under Push alerts, and turns them off with it", async () => {
    setup({
      "/notification-settings": {
        body: {
          ...NOTIFICATIONS_ANSWERED,
          settings: { ...NOTIFICATIONS_ANSWERED.settings, push: false },
        },
      },
    });
    const section = await card();
    for (const name of ["Side Bet's limit", "Urgent notes and Pip's take", "Your week is ready"]) {
      expect(within(section).getByRole("switch", { name })).toBeDisabled();
    }
    expect(within(section).getByRole("switch", { name: "Push alerts" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("saves one switch at a time", async () => {
    const saved: unknown[] = [];
    setup({
      "/notification-settings": (init) => {
        if (init?.method === "PUT") {
          const change = JSON.parse(String(init.body)) as Record<string, boolean>;
          saved.push(change);
          return {
            body: {
              ...NOTIFICATIONS_ANSWERED,
              settings: { ...NOTIFICATIONS_ANSWERED.settings, ...change },
            },
          };
        }
        return { body: NOTIFICATIONS_ANSWERED };
      },
    });
    const section = await card();
    fireEvent.click(within(section).getByRole("switch", { name: "Side Bet's limit" }));
    await waitFor(() => expect(saved).toEqual([{ pushLimit: false }]));
    expect(within(section).getByRole("switch", { name: "Side Bet's limit" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("says urgent notes are for personal research, to everyone else", async () => {
    setup({}, false);
    const section = await card();
    await within(section).findByText("Urgent notes are for accounts with personal research on.");
    expect(
      within(section).getByRole("switch", { name: "Urgent notes and Pip's take" }),
    ).toBeDisabled();
  });

  it("says where the email goes and when Pip last checked", async () => {
    setup({
      "/status": {
        body: { lastCheckedAt: new Date(Date.now() - 12 * 60_000).toISOString(), stale: false },
      },
    });
    const section = await card();
    expect(await within(section).findByText(/Monday morning, to/)).toBeInTheDocument();
    expect(
      await within(section).findByText("Pip last checked prices and news 12 min ago."),
    ).toBeInTheDocument();
  });

  it("says plainly when that was longer ago than usual", async () => {
    setup({
      "/status": {
        body: { lastCheckedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), stale: true },
      },
    });
    const section = await card();
    expect(
      await within(section).findByText(/3 hours ago — longer ago than usual\./),
    ).toBeInTheDocument();
  });
});

import { EMPTY_PROFILE, type NotificationsView } from "@finance-app/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WAQAR } from "../test/fake-auth";
import {
  ME_ALLOWED,
  NOTIFICATIONS_ANSWERED,
  renderRoute,
  type Handler,
} from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth, TABLET_WIDTH } from "../test/setup";

/**
 * The bell (DESIGN §10.3): on every screen at every width, an unread count in
 * `solid`, the last 30 days grouped Today / This week / Earlier, rows that
 * open where they came from and mark themselves read, and the two masters at
 * the foot — the same switches Setup shows.
 */

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const FEED: NotificationsView = {
  unread: 2,
  items: [
    {
      kind: "limit_alert",
      id: "a1",
      title: "Side Bet is near its limit",
      bucket: "Degen",
      at: minutesAgo(120),
      read: false,
      url: "/rules",
    },
    {
      kind: "nudge",
      id: "n1",
      title: "ASML is down £240 today",
      body: "That's past twice your big-move line.",
      bucket: "Medium",
      at: daysAgo(3),
      read: false,
      url: "/week",
    },
    {
      kind: "connection_gap",
      id: "g1",
      title: "Kraken went quiet",
      body: "Side Bet's number is from 06:40.",
      at: daysAgo(12),
      read: true,
      url: "/setup",
    },
  ],
};

function api(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    ...ME_ALLOWED,
    "/connections": { body: [] },
    "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
    "/profile": { body: { profile: EMPTY_PROFILE, personalised: true } },
    "/notifications": { body: FEED },
    ...overrides,
  };
}

const openBell = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
  return screen.findByRole("dialog", { name: "Notifications" });
};

describe("the bell", () => {
  it.each([
    ["phone", PHONE_WIDTH],
    ["tablet", TABLET_WIDTH],
    ["desktop", DESKTOP_WIDTH],
  ])("is on the %s screen with its unread count", async (_name, width) => {
    setViewportWidth(width);
    renderRoute("/setup", { session: WAQAR, api: api() });
    const bell = await screen.findByRole("button", { name: "Notifications, 2 unread" });
    expect(bell).toHaveTextContent("2");
  });

  it("says nothing extra when everything is read", async () => {
    renderRoute("/setup", {
      session: WAQAR,
      api: api({ "/notifications": { body: { items: [], unread: 0 } } }),
    });
    expect(await screen.findByRole("button", { name: "Notifications" })).not.toHaveTextContent(
      /\d/,
    );
  });

  it("lists the last 30 days, grouped, newest first", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderRoute("/setup", { session: WAQAR, api: api() });
    const panel = await openBell();
    const headings = within(panel)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Today", "This week", "Earlier"]);
    expect(panel).toHaveTextContent("Side Bet is near its limit");
    expect(panel).toHaveTextContent("2 hours ago · Side Bet");
    expect(within(panel).getAllByLabelText("Unread")).toHaveLength(2);
  });

  it("opens where a row came from, and marks it read", async () => {
    setViewportWidth(PHONE_WIDTH);
    const marked: unknown[] = [];
    const { router } = renderRoute("/setup", {
      session: WAQAR,
      api: api({
        "/notifications/read": (init) => {
          marked.push(JSON.parse(String(init?.body)));
          return { body: { ...FEED, unread: 1 } };
        },
      }),
    });
    const panel = await openBell();
    fireEvent.click(within(panel).getByRole("button", { name: /Side Bet is near its limit/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/rules"));
    expect(marked).toEqual([{ items: [{ kind: "limit_alert", id: "a1" }] }]);
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("marks everything read at once", async () => {
    const marked: unknown[] = [];
    renderRoute("/setup", {
      session: WAQAR,
      api: api({
        "/notifications/read": (init) => {
          marked.push(JSON.parse(String(init?.body)));
          return { body: { items: FEED.items.map((i) => ({ ...i, read: true })), unread: 0 } };
        },
      }),
    });
    const panel = await openBell();
    fireEvent.click(within(panel).getByRole("button", { name: "Mark all read" }));
    await waitFor(() =>
      expect(marked).toEqual([
        {
          items: [
            { kind: "limit_alert", id: "a1" },
            { kind: "nudge", id: "n1" },
          ],
        },
      ]),
    );
    expect(within(panel).queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
  });

  it("is calm when there's nothing", async () => {
    renderRoute("/setup", {
      session: WAQAR,
      api: api({ "/notifications": { body: { items: [], unread: 0 } } }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(panel).toHaveTextContent("Which is the normal amount.");
  });

  it("says so when the list can't load, and the switches still work", async () => {
    renderRoute("/setup", {
      session: WAQAR,
      api: api({ "/notifications": { status: 500, body: { error: "boom" } } }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(
      await within(panel).findByText(/Couldn't load your notifications/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("switch", { name: "Push alerts" })).toBeInTheDocument();
  });

  it("keeps its switches and Setup's in step", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    const saved: unknown[] = [];
    renderRoute("/setup", {
      session: WAQAR,
      api: api({
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
      }),
    });
    const panel = await openBell();
    fireEvent.click(within(panel).getByRole("switch", { name: "Weekly email" }));
    await waitFor(() => expect(saved).toEqual([{ email: false }]));

    const setup = await screen.findByRole("region", { name: "Notifications" });
    await waitFor(() =>
      expect(within(setup).getByRole("switch", { name: "Weekly email" })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
  });
});

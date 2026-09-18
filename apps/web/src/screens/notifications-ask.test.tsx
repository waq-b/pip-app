import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WAQAR } from "../test/fake-auth";
import {
  ME_ALLOWED,
  NOTIFICATIONS_ANSWERED,
  renderRoute,
  type Handler,
} from "../test/render-route";

/**
 * First login, step 1 of 2 (DESIGN §10.2): Pip asks first, the phone's prompt
 * only follows a tap on the primary button, and "Not now" is a real answer —
 * the sheet never comes back.
 */

const UNASKED = { ...NOTIFICATIONS_ANSWERED, asked: false, vapidPublicKey: "AQID" };

const potSummary = (bucket: "Base" | "Medium", value: number, share: number) => ({
  bucket,
  value,
  change: { amount: 1_140, percent: 0.14, direction: "up" as const },
  blurb: "",
  shareOfTotal: share,
  targetPercent: 75,
  series: [{ at: "2026-09-15T00:00:00Z", value: 110 }],
});

function api(settings: Handler): Record<string, Handler> {
  return {
    ...ME_ALLOWED,
    "/notification-settings": settings,
    "/net-assets": { body: { set: false, starterLimit: true, dueReview: false } },
    "/portfolio": {
      body: {
        timeframe: "day",
        total: 1_065_000,
        change: { amount: 2_580, percent: 0.23, direction: "up" },
        verdict: "Up £25.80 today. Nothing needs you.",
        buckets: [potSummary("Base", 824_000, 77), potSummary("Medium", 241_000, 23)],
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
    "/week": { body: { week: null, today: [], pastWeeks: [] } },
  };
}

/** Saves the answers it gets, and answers with what was saved. */
function savingSettings() {
  const saved: unknown[] = [];
  const handler: Handler = (init) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as Record<string, boolean>;
      saved.push(body);
      return { body: { ...UNASKED, asked: true } };
    }
    return { body: UNASKED };
  };
  return { saved, handler };
}

const sheet = () => screen.findByRole("dialog", { name: "Notifications" });

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the ask", () => {
  it("comes first, before the net-assets question, once Pip has something to show", async () => {
    renderRoute("/", { session: WAQAR, api: api({ body: UNASKED }) });
    const ask = await sheet();
    expect(within(ask).getByText("First login · step 1 of 2")).toBeInTheDocument();
    expect(ask).toHaveTextContent("Want Pip to tell you when something matters?");
    expect(within(ask).getByRole("switch", { name: "Push alerts" })).toBeChecked();
    expect(within(ask).getByRole("switch", { name: "Weekly email" })).toBeChecked();
    expect(screen.queryByRole("region", { name: "Your net assets" })).not.toBeInTheDocument();
  });

  it("says what the button will do as the switches change", async () => {
    renderRoute("/", { session: WAQAR, api: api({ body: UNASKED }) });
    const ask = await sheet();
    const button = () =>
      within(ask)
        .getAllByRole("button")
        .find((b) => b.textContent?.startsWith("Turn") || b.textContent === "Save")!;
    expect(button()).toHaveTextContent("Turn these on");
    fireEvent.click(within(ask).getByRole("switch", { name: "Push alerts" }));
    expect(button()).toHaveTextContent("Turn on email only");
    fireEvent.click(within(ask).getByRole("switch", { name: "Weekly email" }));
    expect(button()).toHaveTextContent("Save");
    fireEvent.click(within(ask).getByRole("switch", { name: "Push alerts" }));
    expect(button()).toHaveTextContent("Turn on alerts only");
  });

  it("isn't shown to someone who has answered", async () => {
    renderRoute("/", { session: WAQAR, api: api({ body: NOTIFICATIONS_ANSWERED }) });
    await screen.findByRole("region", { name: "Your net assets" });
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("takes 'Not now' as a real answer: nothing pushed, no email, and it says so", async () => {
    const { saved, handler } = savingSettings();
    renderRoute("/", { session: WAQAR, api: api(handler) });
    const ask = await sheet();
    fireEvent.click(within(ask).getByRole("button", { name: "Not now" }));

    expect(await within(ask).findByText("Fine. Pip will stay quiet.")).toBeInTheDocument();
    expect(saved).toEqual([{ push: false, email: false, answered: true }]);
    expect(ask).toHaveTextContent("Notifications off · the bell still works");

    fireEvent.click(within(ask).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument(),
    );
    // Then step 2.
    expect(await screen.findByRole("region", { name: "Your net assets" })).toBeInTheDocument();
  });

  it("asks the phone only from the tap, and subscribes this device", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    vi.stubGlobal(
      "Notification",
      Object.assign(function () {}, { permission: "default", requestPermission }),
    );
    vi.stubGlobal("PushManager", function () {});
    const subscribe = vi.fn(async () => ({
      endpoint: "https://fcm.googleapis.com/one",
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/one",
        keys: { p256dh: "p", auth: "a" },
      }),
    }));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe } }),
      },
    });

    const { saved, handler } = savingSettings();
    const posted: unknown[] = [];
    renderRoute("/", {
      session: WAQAR,
      api: {
        ...api(handler),
        "/push/subscriptions": (init) => {
          posted.push(JSON.parse(String(init?.body)));
          return { body: { ...UNASKED, asked: true } };
        },
      },
    });
    const ask = await sheet();
    expect(requestPermission).not.toHaveBeenCalled();

    fireEvent.click(within(ask).getByRole("button", { name: "Turn these on" }));
    expect(requestPermission).toHaveBeenCalledOnce();
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      endpoint: "https://fcm.googleapis.com/one",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(saved).toEqual([{ push: true, email: true, answered: true }]);
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it("on an iPhone in a Safari tab, says to add Pip to the Home Screen instead of asking", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
    );
    const { saved, handler } = savingSettings();
    renderRoute("/", { session: WAQAR, api: api(handler) });
    const ask = await sheet();
    fireEvent.click(within(ask).getByRole("button", { name: "Turn these on" }));

    expect(await within(ask).findByText("One more step on this iPhone")).toBeInTheDocument();
    expect(ask).toHaveTextContent("tap Share, then Add to Home Screen");
    expect(saved).toEqual([{ push: true, email: true, answered: true }]);
    vi.restoreAllMocks();
  });
});

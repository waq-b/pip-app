import { EMPTY_PROFILE } from "@finance-app/shared";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WarmingUp } from "../shell/warming-up";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, NOTIFICATIONS_ANSWERED, renderRoute } from "../test/render-route";

/**
 * This device on Setup (DESIGN §10.4), and "Pip's warming up" (DESIGN §9):
 * the row says plainly what this device can do, and a sleeping Pip says so
 * instead of showing a blank screen.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const setup = (vapidPublicKey: string | null) =>
  renderRoute("/setup", {
    session: WAQAR,
    api: {
      ...ME_ALLOWED,
      "/connections": { body: [] },
      "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
      "/profile": { body: { profile: EMPTY_PROFILE, personalised: false } },
      "/notification-settings": { body: { ...NOTIFICATIONS_ANSWERED, vapidPublicKey } },
    },
  });

const row = () => screen.findByRole("group", { name: "This device" });

describe("this device", () => {
  it("says when the server can't push yet, with no button", async () => {
    setup(null);
    const device = await row();
    expect(await within(device).findByText("Pip can't send pushes yet.")).toBeInTheDocument();
    expect(within(device).queryByRole("button")).not.toBeInTheDocument();
  });

  it("tells an iPhone in a Safari tab to add Pip to the Home Screen, with no button", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
    );
    setup("AQID");
    const device = await row();
    expect(
      await within(device).findByText(/add Pip to your Home Screen first/),
    ).toBeInTheDocument();
    expect(within(device).queryByRole("button")).not.toBeInTheDocument();
  });

  it("says a browser without web push can't show them", async () => {
    setup("AQID");
    const device = await row();
    expect(
      await within(device).findByText("This browser can't show notifications from Pip."),
    ).toBeInTheDocument();
  });

  it("offers the button where the browser can ask", async () => {
    vi.stubGlobal(
      "Notification",
      Object.assign(function () {}, { permission: "default" }),
    );
    vi.stubGlobal("PushManager", function () {});
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
    setup("AQID");
    const device = await row();
    expect(await within(device).findByText("Off on this device.")).toBeInTheDocument();
    expect(
      within(device).getByRole("button", { name: "Turn on for this device" }),
    ).toBeInTheDocument();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    vi.unstubAllGlobals();
  });
});

describe("Pip's warming up", () => {
  it("stays blank for a moment, then says Pip is waking — nothing to tap", () => {
    vi.useFakeTimers();
    render(<WarmingUp />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3_000));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Pip's warming up");
    expect(status).toHaveTextContent("This screen will change by itself.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

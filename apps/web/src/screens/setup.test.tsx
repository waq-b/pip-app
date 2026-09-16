import type { Connection, ConnectResult } from "@finance-app/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { BigNumber } from "../components/big-number";
import { ago, maskKey, splitMessage } from "../lib/connections";
import { HIDE_NUMBERS_STORAGE_KEY } from "../lib/hide-numbers";
import { WAQAR } from "../test/fake-auth";
import { ME_ALLOWED, renderRoute, type Handler } from "../test/render-route";
import { DESKTOP_WIDTH, PHONE_WIDTH, setViewportWidth } from "../test/setup";

const MINUTES_AGO = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function connections(
  overrides: Partial<Record<Connection["provider"], Partial<Connection>>> = {},
): Connection[] {
  return [
    {
      provider: "trading212",
      displayName: "Trading 212",
      status: "live",
      feeds: ["Base", "Medium"],
      holdingsSeen: 8,
      lastReadAt: MINUTES_AGO(4),
      ...overrides.trading212,
    },
    {
      provider: "kraken",
      displayName: "Kraken",
      status: "live",
      feeds: ["Degen"],
      holdingsSeen: 3,
      lastReadAt: MINUTES_AGO(11),
      ...overrides.kraken,
    },
  ];
}

const NOTHING = connections({
  trading212: { status: "not_connected", lastReadAt: undefined },
  kraken: { status: "not_connected", lastReadAt: undefined },
});

function api(
  extra: Record<string, Handler> = {},
  list: Connection[] = connections(),
): Record<string, Handler> {
  return {
    ...ME_ALLOWED,
    "/rules": { body: { rules: [], monthlySplit: { total: 0, perBucket: [] } } },
    "/connections": { body: list },
    ...extra,
  };
}

beforeEach(() => {
  setViewportWidth(PHONE_WIDTH);
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("the setup screen", () => {
  it("lists where Pip reads from, with what each feeds and how fresh it is", async () => {
    renderRoute("/setup", { session: WAQAR, api: api() });

    expect(await screen.findByRole("heading", { name: "Setup", level: 1 })).toBeInTheDocument();
    const t212 = await screen.findByRole("button", { name: /Trading 212/ });
    expect(t212).toHaveTextContent("Foundation + Handpicked · synced 4 min ago");
    expect(t212).toHaveTextContent("Live");
    expect(screen.getByRole("button", { name: /Kraken/ })).toHaveTextContent(
      "Side Bet · synced 11 min ago",
    );
  });

  it("opens a connection to show it's read-only, and can disconnect it", async () => {
    let deleted = false;
    renderRoute("/setup", {
      session: WAQAR,
      api: api({
        "/connections/kraken": (init) => {
          deleted = init?.method === "DELETE";
          return { body: { status: "disconnected", provider: "kraken" } };
        },
      }),
    });

    fireEvent.click(await screen.findByRole("button", { name: /Kraken/ }));
    expect(screen.getByText("This key cannot place orders. Pip checked.")).toBeInTheDocument();
    expect(screen.getByText("Holdings seen").nextSibling).toHaveTextContent("3");

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("button", { name: "Connect Kraken" })).toBeInTheDocument();
    expect(deleted).toBe(true);
    expect(screen.queryByRole("button", { name: /Kraken.*Live/ })).not.toBeInTheDocument();
  });

  it("offers every provider when nothing is plugged in", async () => {
    renderRoute("/setup", { session: WAQAR, api: api({}, NOTHING) });

    expect(
      await screen.findByRole("heading", { name: "Nothing plugged in yet" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trading 212" }));
    expect(screen.getByText("Open Trading 212 → Settings → API")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Trading 212" })).toBeDisabled();
  });

  it("goes straight to the one account left when only one isn't connected", async () => {
    renderRoute("/setup", {
      session: WAQAR,
      api: api({}, connections({ kraken: { status: "not_connected", lastReadAt: undefined } })),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Connect another account" }));
    expect(screen.getByRole("button", { name: "Connect Kraken" })).toBeInTheDocument();
  });

  it("hides Connect another account when everything is already connected", async () => {
    renderRoute("/setup", { session: WAQAR, api: api() });

    await screen.findByRole("button", { name: /Kraken/ });
    expect(
      screen.queryByRole("button", { name: "Connect another account" }),
    ).not.toBeInTheDocument();
  });

  it("shows a loading shape, then offers a retry when connections can't load", async () => {
    let calls = 0;
    const { container } = renderRoute("/setup", {
      session: WAQAR,
      api: api({
        "/connections": () => {
          calls += 1;
          return calls === 1 ? { status: 500, body: {} } : { body: connections() };
        },
      }),
    });

    await waitFor(() =>
      expect(container.querySelector('[aria-busy="true"] [data-skeleton]')).toBeInTheDocument(),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Trading 212/ })).toBeInTheDocument();
  });

  it("puts connections and preferences side by side on desktop, with laptop wording", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/setup", { session: WAQAR, api: api() });

    const connectionsSection = await screen.findByRole("region", { name: "Connections" });
    expect(connectionsSection.parentElement).toHaveClass("grid-cols-2");
    expect(
      screen.getByText(
        "Pip uses read-only keys. Even if someone took your laptop, they couldn't trade.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Blur totals until you click")).toBeInTheDocument();
  });
});

describe("connecting an account", () => {
  function connectWith(result: ConnectResult | { status: number }) {
    const bodies: unknown[] = [];
    renderRoute("/setup", {
      session: WAQAR,
      api: api(
        {
          "/connections/kraken": (init) => {
            bodies.push(JSON.parse(String(init?.body)));
            return "status" in result ? { status: result.status, body: {} } : { body: result };
          },
        },
        NOTHING,
      ),
    });
    return bodies;
  }

  async function pasteKey(key: string) {
    fireEvent.click(await screen.findByRole("button", { name: "Kraken" }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: key } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Kraken" }));
  }

  it("sends the key, then shows the connection as live and read-only", async () => {
    const bodies = connectWith({
      outcome: "connected",
      provider: "kraken",
      message: "Connected. Pip checked: this key cannot place orders.",
    });
    await pasteKey("kr-live-readonly-9f2c8814");

    expect(
      await screen.findByText("This key cannot place orders. Pip checked."),
    ).toBeInTheDocument();
    expect(bodies).toEqual([{ key: "kr-live-readonly-9f2c8814" }]);
    expect(screen.getByRole("button", { name: /Kraken/ })).toHaveTextContent("Live");
  });

  it("explains a key the provider doesn't recognise, showing it back masked", async () => {
    connectWith({
      outcome: "invalid_key",
      provider: "kraken",
      message:
        "Kraken doesn't recognise that key. Usually a stray space at one end. Nothing is connected, and nothing was changed.",
    });
    await pasteKey("kr-live-9f2c-bad-8814");

    const refusal = await screen.findByRole("alert");
    expect(
      within(refusal).getByRole("heading", { name: "Kraken doesn't recognise that key" }),
    ).toBeInTheDocument();
    expect(refusal).toHaveTextContent("Nothing is connected, and nothing was changed.");
    expect(screen.getByText("kr-live-9…8814")).toBeInTheDocument();
    expect(screen.queryByText("kr-live-9f2c-bad-8814")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try that again" }));
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });

  it("refuses a key that can trade, naming what must be off, with no way round it", async () => {
    connectWith({
      outcome: "too_much_access",
      provider: "kraken",
      message:
        "That key can do too much. It can trade and withdraw. Pip only ever accepts keys that can look, so it won't store this one.",
      permissions: [
        { name: "Query funds", granted: true, required: true },
        { name: "Create & cancel orders", granted: true, required: false },
        { name: "Withdraw funds", granted: true, required: false },
      ],
    });
    await pasteKey("kr-live-trade-withdraw-key");

    expect(
      await screen.findByRole("heading", { name: "That key can do too much" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Refused on purpose")).toBeInTheDocument();
    expect(screen.getByText(/Query funds/)).toHaveTextContent("Query funds — needed");
    expect(screen.getByText(/Create & cancel orders/)).toHaveTextContent(
      "Create & cancel orders — must be off",
    );
    expect(screen.getByText(/Withdraw funds/)).toHaveTextContent("Withdraw funds — must be off");
    expect(screen.queryByRole("button", { name: /anyway|use it/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Make a read-only key" }));
    expect(screen.getByRole("button", { name: "Connect Kraken" })).toBeInTheDocument();
  });

  it("says nothing was connected when Pip can't be reached", async () => {
    connectWith({ status: 500 });
    await pasteKey("kr-live-readonly-9f2c8814");

    expect(
      await screen.findByRole("heading", { name: "Couldn't reach Pip just now" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing is connected, and nothing was changed.")).toBeInTheDocument();
  });
});

describe("preferences", () => {
  it("switches appearance, and can go back to following the device", async () => {
    renderRoute("/setup", { session: WAQAR, api: api() });

    expect(await screen.findByText("Follows your phone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Follow your phone instead" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(screen.getByText("Follows your phone")).toBeInTheDocument();
  });

  it("remembers Hide the numbers on this device", async () => {
    renderRoute("/setup", { session: WAQAR, api: api() });

    const toggle = await screen.findByRole("switch", { name: "Hide the numbers" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem(HIDE_NUMBERS_STORAGE_KEY)).toBe("on");
  });

  it("shows currency as pounds, fixed, and has no Nudge me", async () => {
    renderRoute("/setup", { session: WAQAR, api: api() });

    expect(await screen.findByText("£ GBP")).toBeInTheDocument();
    expect(screen.queryByText(/Nudge me/)).not.toBeInTheDocument();
  });
});

describe("hidden numbers", () => {
  it("blurs the big number until it's tapped", () => {
    window.localStorage.setItem(HIDE_NUMBERS_STORAGE_KEY, "on");
    render(<BigNumber label="Everything you own" value={1_234_567} />);

    const reveal = screen.getByRole("button", { name: "Show the numbers" });
    expect(reveal.querySelector(".blur-\\[10px\\]")).toBeInTheDocument();
    fireEvent.click(reveal);
    expect(screen.queryByRole("button", { name: "Show the numbers" })).not.toBeInTheDocument();
    expect(screen.getByText("£12,345")).toBeInTheDocument();
  });

  it("shows the big number plainly when the setting is off", () => {
    render(<BigNumber label="Everything you own" value={1_234_567} />);
    expect(screen.queryByRole("button", { name: "Show the numbers" })).not.toBeInTheDocument();
  });
});

describe("connection helpers", () => {
  it("masks a key, keeping only enough to recognise it", () => {
    expect(maskKey("  kr-live-9f2c0000000000008814 ")).toBe("kr-live-9…8814");
    expect(maskKey("short")).toBe("•••••");
  });

  it("splits a message into heading and body", () => {
    expect(splitMessage("That key can do too much. It can trade.")).toEqual({
      heading: "That key can do too much",
      body: "It can trade.",
    });
    expect(splitMessage("Connected.")).toEqual({ heading: "Connected", body: "" });
  });

  it("says how long ago, falling back to a date", () => {
    const now = Date.parse("2026-09-16T10:00:00Z");
    expect(ago("2026-09-16T09:56:00Z", now)).toBe("4 min ago");
    expect(ago("2026-09-16T07:00:00Z", now)).toBe("3 hours ago");
    expect(ago("2026-09-12T10:00:00Z", now)).toBe("on 12 Sep");
  });
});

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

function connections(overrides: Record<string, Partial<Connection>> = {}): Connection[] {
  return [
    {
      id: "trading212:isa",
      provider: "trading212",
      accountKind: "isa",
      displayName: "Trading 212 ISA",
      status: "live",
      feeds: ["Base"],
      holdingsSeen: 3,
      lastReadAt: MINUTES_AGO(4),
      available: true,
      permissionsVerified: false,
      ...overrides["trading212:isa"],
    },
    {
      id: "trading212:invest",
      provider: "trading212",
      accountKind: "invest",
      displayName: "Trading 212 Invest",
      status: "live",
      feeds: ["Medium"],
      holdingsSeen: 5,
      lastReadAt: MINUTES_AGO(4),
      available: true,
      permissionsVerified: false,
      ...overrides["trading212:invest"],
    },
    {
      id: "kraken",
      provider: "kraken",
      displayName: "Kraken",
      status: "live",
      feeds: ["Degen"],
      holdingsSeen: 3,
      lastReadAt: MINUTES_AGO(11),
      available: true,
      permissionsVerified: true,
      ...overrides.kraken,
    },
  ];
}

const disconnected = {
  status: "not_connected" as const,
  lastReadAt: undefined,
  holdingsSeen: undefined,
};
const NOTHING = connections({
  "trading212:isa": disconnected,
  "trading212:invest": disconnected,
  kraken: disconnected,
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
    const isa = await screen.findByRole("button", { name: /Trading 212 ISA/ });
    expect(isa).toHaveTextContent("Foundation · synced 4 min ago");
    expect(isa).toHaveTextContent("Live");
    expect(screen.getByRole("button", { name: /Trading 212 Invest/ })).toHaveTextContent(
      "Handpicked · synced 4 min ago",
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Trading 212 ISA" }));
    expect(screen.getByText("Open Trading 212 → Settings → API (Beta)")).toBeInTheDocument();
    expect(screen.getByLabelText("API secret")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Trading 212 ISA" })).toBeDisabled();
  });

  it("goes straight to the one account left when only one isn't connected", async () => {
    renderRoute("/setup", {
      session: WAQAR,
      api: api({}, connections({ kraken: disconnected })),
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
    expect(await screen.findByRole("button", { name: /Trading 212 ISA/ })).toBeInTheDocument();
  });

  it("puts connections and preferences side by side on desktop, with laptop wording", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderRoute("/setup", { session: WAQAR, api: api() });

    const connectionsSection = await screen.findByRole("region", { name: "Connections" });
    expect(connectionsSection.parentElement).toHaveClass("grid-cols-2");
    expect(
      screen.getByText(
        "Pip only reads your accounts. Even if someone took your laptop, they couldn't trade.",
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
    fireEvent.change(screen.getByLabelText("Private key"), {
      target: { value: "kraken-private-key-base64==" },
    });
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
    expect(bodies).toEqual([
      { key: "kr-live-readonly-9f2c8814", secret: "kraken-private-key-base64==" },
    ]);
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

  it("asks for Kraken's private key and won't send without it", async () => {
    const bodies = connectWith({ outcome: "connected", provider: "kraken", message: "Connected." });
    fireEvent.click(await screen.findByRole("button", { name: "Kraken" }));
    expect(
      screen.getByText(/Tick only Funds: Query and Data: Query ledger entries/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Pip checks this key can't trade, withdraw or deposit/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "kr-live-readonly-9f2c8814" },
    });
    expect(screen.getByLabelText("Private key")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Connect Kraken" })).toBeDisabled();
    expect(bodies).toEqual([]);
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

describe("connecting a Trading 212 account", () => {
  function connectT212(result: ConnectResult) {
    const bodies: unknown[] = [];
    renderRoute("/setup", {
      session: WAQAR,
      api: api(
        {
          "/connections/trading212": (init) => {
            bodies.push(JSON.parse(String(init?.body)));
            return { body: result };
          },
        },
        NOTHING,
      ),
    });
    return bodies;
  }

  async function paste() {
    fireEvent.click(await screen.findByRole("button", { name: "Trading 212 Invest" }));
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "t212-key-0123456789" },
    });
    fireEvent.change(screen.getByLabelText("API secret"), { target: { value: "t212-secret-000" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Trading 212 Invest" }));
  }

  it("asks for the key and secret, says Pip can't check permissions, and sends which account", async () => {
    const bodies = connectT212({
      outcome: "connected",
      provider: "trading212",
      accountKind: "invest",
      message: "Connected. Pip is reading your Trading 212 Invest account.",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Trading 212 Invest" }));
    expect(
      screen.getByText(
        "Pip can't check a Trading 212 key's permissions, and it has no code that can place an order either way.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("API secret")).toHaveAttribute("type", "password");
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "t212-key-0123456789" },
    });
    expect(screen.getByRole("button", { name: "Connect Trading 212 Invest" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("API secret"), { target: { value: "t212-secret-000" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Trading 212 Invest" }));

    expect(
      await screen.findByText(
        "Pip only reads this account. It can't check a Trading 212 key's permissions, and it has no code that places orders.",
      ),
    ).toBeInTheDocument();
    expect(bodies).toEqual([
      { key: "t212-key-0123456789", secret: "t212-secret-000", accountKind: "invest" },
    ]);
    expect(
      screen.queryByText("This key cannot place orders. Pip checked."),
    ).not.toBeInTheDocument();
  });

  it("names a missing permission and offers to start again with a new key", async () => {
    connectT212({
      outcome: "missing_permission",
      provider: "trading212",
      accountKind: "invest",
      missingPermission: "Account data",
      message:
        "That key can't see your Account data. Make a new key with Account data, Portfolio, Metadata and History ticked. Nothing is connected.",
    });
    await paste();

    expect(
      await screen.findByRole("heading", { name: "That key can't see your Account data" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Needs a different key")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make a new key" }));
    expect(screen.getByLabelText("API secret")).toHaveValue("");
  });

  it.each([
    [
      "not_pounds",
      "That account isn't in pounds. Pip only works in pounds for now.",
      "Try a different account",
    ],
    [
      "unavailable",
      "Trading 212 isn't answering right now. Nothing is connected.",
      "Try that again",
    ],
  ] as const)("explains %s", async (outcome, message, action) => {
    connectT212({ outcome, provider: "trading212", accountKind: "invest", message });
    await paste();
    expect(await screen.findByRole("alert")).toHaveTextContent(message.split(". ")[0]!);
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
  });

  it("shows Kraken as coming soon when Pip can't connect it yet", async () => {
    renderRoute("/setup", {
      session: WAQAR,
      api: api(
        {},
        connections({
          "trading212:invest": disconnected,
          kraken: { ...disconnected, available: false },
        }),
      ),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Connect another account" }));
    expect(screen.getByRole("button", { name: "Trading 212 Invest" })).toBeEnabled();
    const kraken = screen.getByRole("button", { name: /Kraken/ });
    expect(kraken).toBeDisabled();
    expect(kraken).toHaveTextContent("Coming soon");
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePush, safePath } from "../sw-message";
import {
  baseState,
  checkThisDevice,
  deviceLabel,
  isAppleMobile,
  keyBytes,
  type PushEnvironment,
} from "./push";

/**
 * Push on this device (phase-6.md decision 5). The rules that matter: an
 * iPhone in a Safari tab is told to add Pip to the Home Screen, a push can
 * only ever open a screen inside Pip, and a dropped subscription is mended
 * quietly when permission is still granted.
 */

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 Chrome/128";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128";

const env = (overrides: Partial<PushEnvironment> = {}): PushEnvironment => ({
  userAgent: MAC,
  maxTouchPoints: 0,
  standalone: false,
  supported: true,
  permission: "default",
  ...overrides,
});

describe("what a push carries", () => {
  it("shows the server's title, body and screen", () => {
    expect(
      parsePush(JSON.stringify({ title: "Your week is ready", body: "2 things.", url: "/week" })),
    ).toEqual({
      title: "Your week is ready",
      body: "2 things.",
      url: "/week",
    });
  });

  it("falls back to plain words and home on anything malformed", () => {
    expect(parsePush("not json")).toEqual({ title: "Pip", body: "", url: "/" });
    expect(parsePush(null)).toEqual({ title: "Pip", body: "", url: "/" });
  });

  it("only ever opens a screen inside Pip", () => {
    for (const url of ["https://evil.test", "//evil.test/x", "javascript:alert(1)", 42]) {
      expect(safePath(url)).toBe("/");
    }
    expect(safePath("/rules")).toBe("/rules");
  });
});

describe("the device", () => {
  it("names itself plainly", () => {
    expect(deviceLabel(env({ userAgent: IPHONE }))).toBe("iPhone");
    expect(deviceLabel(env({ userAgent: IPAD, maxTouchPoints: 5 }))).toBe("iPad");
    expect(deviceLabel(env({ userAgent: ANDROID_TABLET }))).toBe("Android tablet");
    expect(deviceLabel(env({ userAgent: ANDROID_PHONE }))).toBe("Android phone");
    expect(deviceLabel(env({ userAgent: MAC }))).toBe("Mac");
  });

  it("knows an iPad that calls itself a Mac", () => {
    expect(isAppleMobile(env({ userAgent: IPAD, maxTouchPoints: 5 }))).toBe(true);
    expect(isAppleMobile(env({ userAgent: MAC }))).toBe(false);
  });

  it("sends an iPhone in a Safari tab to the Home Screen, and asks the installed app", () => {
    expect(baseState(env({ userAgent: IPHONE }), "key")).toBe("needs_install");
    expect(baseState(env({ userAgent: IPHONE, standalone: true }), "key")).toBeNull();
  });

  it("says so when the server can't push, the browser can't, or it's blocked", () => {
    expect(baseState(env(), null)).toBe("server_off");
    expect(baseState(env({ supported: false }), "key")).toBe("unsupported");
    expect(baseState(env({ permission: "denied" }), "key")).toBe("blocked");
  });

  it("turns the VAPID key into bytes", () => {
    expect([...keyBytes("AQID")]).toEqual([1, 2, 3]);
    expect([...keyBytes("-_8")]).toEqual([251, 255]);
  });
});

describe("the check on every open", () => {
  afterEach(() => vi.unstubAllGlobals());

  function browser(existing: { endpoint: string } | null) {
    const subscription = (endpoint: string) => ({
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    });
    const subscribe = vi.fn(async () => subscription("https://web.push.apple.com/new"));
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => (existing ? subscription(existing.endpoint) : null),
            subscribe,
          },
        }),
      },
    });
    return { subscribe };
  }

  function server(known: boolean) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${String(input)}`);
        const body = String(input).includes("this-device") ? { known } : {};
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    return calls;
  }

  it("does nothing more when both sides still know this device", async () => {
    browser({ endpoint: "https://web.push.apple.com/one" });
    const calls = server(true);
    expect(await checkThisDevice("AQID", env({ permission: "granted" }))).toBe("on");
    expect(calls).toEqual([
      `GET /api/push/subscriptions/this-device?endpoint=${encodeURIComponent("https://web.push.apple.com/one")}`,
    ]);
  });

  it("tells the server again when it lost this device", async () => {
    browser({ endpoint: "https://web.push.apple.com/one" });
    const calls = server(false);
    expect(await checkThisDevice("AQID", env({ permission: "granted" }))).toBe("on");
    expect(calls.at(-1)).toBe("POST /api/push/subscriptions");
  });

  it("subscribes again quietly when the browser dropped it but permission stands", async () => {
    const { subscribe } = browser(null);
    const calls = server(false);
    expect(await checkThisDevice("AQID", env({ permission: "granted" }))).toBe("on");
    expect(subscribe).toHaveBeenCalledOnce();
    expect(calls).toEqual(["POST /api/push/subscriptions"]);
  });

  it("never asks for permission: without it, this device is just off", async () => {
    const { subscribe } = browser(null);
    const calls = server(false);
    expect(await checkThisDevice("AQID", env({ permission: "default" }))).toBe("off");
    expect(subscribe).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("says it stopped when it can't mend it", async () => {
    const { subscribe } = browser(null);
    subscribe.mockRejectedValueOnce(new Error("no"));
    server(false);
    expect(await checkThisDevice("AQID", env({ permission: "granted" }))).toBe("stopped");
  });
});

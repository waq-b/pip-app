import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createT212Client,
  T212AuthError,
  T212PermissionError,
  T212ShapeError,
  T212UnavailableError,
} from "./client.js";

const recorded = (name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../fixtures/recorded/t212", name), "utf8"),
  ) as unknown;

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** A fake Trading 212 that answers by path from recorded responses. No network. */
function fakeT212(routes: Record<string, Reply | Reply[]>) {
  const calls: { url: string; method: string; authorization: string }[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      authorization: String((init?.headers as Record<string, string>).Authorization),
    });
    const path = url.replace("https://demo.trading212.com/api/v0", "");
    const route = routes[path];
    const reply = Array.isArray(route) ? route.shift() : route;
    if (!reply) return new Response("", { status: 404 });
    const status = reply.status ?? 200;
    return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), {
      status,
      headers: reply.headers,
    });
  });
  return { fetchMock, calls };
}

function client(
  fetchMock: typeof fetch,
  extra: Partial<Parameters<typeof createT212Client>[0]> = {},
) {
  return createT212Client({
    key: "practice-key",
    secret: "practice-secret",
    env: "demo",
    fetch: fetchMock,
    sleep: async () => {},
    ...extra,
  });
}

describe("the Trading 212 client", () => {
  it("only talks to the practice environment", () => {
    expect(() => createT212Client({ key: "k", secret: "s", env: "live" as "demo" })).toThrow(
      /Only the Trading 212 practice environment/,
    );
  });

  it("signs requests with HTTP Basic key:secret and only ever GETs", async () => {
    const { fetchMock, calls } = fakeT212({
      "/equity/positions": { body: recorded("positions.json") },
    });
    await client(fetchMock).positions();

    expect(calls).toEqual([
      {
        url: "https://demo.trading212.com/api/v0/equity/positions",
        method: "GET",
        authorization: `Basic ${Buffer.from("practice-key:practice-secret").toString("base64")}`,
      },
    ]);
  });

  it("reads recorded positions, keeping the currency of each instrument", async () => {
    const { fetchMock } = fakeT212({ "/equity/positions": { body: recorded("positions.json") } });
    const positions = await client(fetchMock).positions();

    expect(positions.map((p) => [p.instrument.ticker, p.instrument.currency])).toEqual([
      ["NVDA_US_EQ", "USD"],
      ["GRGl_EQ", "GBX"],
      ["ASMLa_EQ", "EUR"],
      ["VWRLl_EQ", "GBP"],
    ]);
    expect(positions[1]!.averagePricePaid).toBeCloseTo(1750, 5);
  });

  it("reads the recorded account summary", async () => {
    const { fetchMock } = fakeT212({
      "/equity/account/summary": { body: recorded("account-summary.json") },
    });
    const summary = await client(fetchMock).accountSummary();
    expect(summary).toMatchObject({ currency: "GBP", cash: { availableToTrade: 0 } });
  });

  it("follows order history across cursor pages and reads each fill", async () => {
    const pages = recorded("orders-pages.json") as {
      path: string;
      body: { nextPagePath: string | null };
    }[];
    const routes: Record<string, Reply> = {};
    // The recorded pages ask for limit=1; serve them as the pages our client will request.
    routes["/equity/history/orders?limit=1"] = { body: pages[0]!.body };
    pages.forEach((page, index) => {
      const next = pages[index + 1];
      if (next) {
        page.body.nextPagePath = `/api/v0/equity/history/orders?cursor=${index + 1}&limit=1`;
        routes[`/equity/history/orders?cursor=${index + 1}&limit=1`] = { body: next.body };
      }
    });
    const { fetchMock } = fakeT212(routes);

    const fills = [];
    for await (const fill of client(fetchMock).fills({ pageSize: 1 })) fills.push(fill);

    expect(fills.map((f) => f.ticker)).toEqual(["ASMLa_EQ", "GRGl_EQ", "VWRLl_EQ", "NVDA_US_EQ"]);
    expect(fills[0]).toMatchObject({
      side: "BUY",
      walletCurrency: "GBP",
      netValue: 1000,
      fees: 1.5,
    });
  });

  it("names the missing permission when T212 answers a bare 403", async () => {
    const { fetchMock } = fakeT212({ "/equity/account/summary": { status: 403 } });
    const error = await client(fetchMock)
      .accountSummary()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(T212PermissionError);
    expect((error as T212PermissionError).permission).toBe("Account data");
  });

  it("treats 401 as a key it doesn't recognise, and doesn't retry", async () => {
    const { fetchMock } = fakeT212({ "/equity/positions": { status: 401 } });
    await expect(client(fetchMock).positions()).rejects.toBeInstanceOf(T212AuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits out a 429 until T212's reset time, then retries", async () => {
    const sleep = vi.fn(async () => {});
    const { fetchMock } = fakeT212({
      "/equity/positions": [
        { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000005" } },
        { body: [] },
      ],
    });
    const positions = await client(fetchMock, { sleep, now: () => 1_000_000_000 }).positions();

    expect(positions).toEqual([]);
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it("gives up after repeated 429s rather than hammering", async () => {
    const { fetchMock } = fakeT212({
      "/equity/positions": Array.from({ length: 5 }, () => ({ status: 429 })),
    });
    await expect(client(fetchMock, { maxRateLimitRetries: 2 }).positions()).rejects.toBeInstanceOf(
      T212UnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("paces the next call when the window is used up", async () => {
    const sleep = vi.fn(async () => {});
    const { fetchMock } = fakeT212({
      "/equity/positions": [
        { body: [], headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000001" } },
        { body: [] },
      ],
    });
    const t212 = client(fetchMock, { sleep, now: () => 1_000_000_000 });
    await t212.positions();
    await t212.positions();
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("fails loudly when the beta API changes shape", async () => {
    const { fetchMock } = fakeT212({
      "/equity/positions": { body: [{ instrument: { ticker: "X" } }] },
    });
    await expect(client(fetchMock).positions()).rejects.toBeInstanceOf(T212ShapeError);
  });

  it("reports an unreachable T212 as unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(client(fetchMock).positions()).rejects.toBeInstanceOf(T212UnavailableError);
  });

  it("has no way to reach order placement or pies", () => {
    const source = readFileSync(resolve(import.meta.dirname, "client.ts"), "utf8");
    expect(source).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    expect(source).not.toMatch(/equity\/orders|\/pies/);
  });
});

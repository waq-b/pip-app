import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createKrakenClient,
  KrakenAuthError,
  KrakenPermissionError,
  KrakenShapeError,
  KrakenUnavailableError,
  signRequest,
} from "./client.js";
import { checkKrakenPermissions } from "./permissions.js";

const recorded = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../fixtures/recorded/kraken", name), "utf8");

// A made-up private key — 64 random bytes, base64. Never a real one.
const SECRET = Buffer.alloc(64, 7).toString("base64");

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function fakeFetch(responses: (string | ((seen: Seen) => string))[], seen: Seen[] = []) {
  let i = 0;
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    const call = {
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: String(init?.body),
    };
    seen.push(call);
    const next = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(typeof next === "function" ? next(call) : next, { status: 200 });
  };
  return impl as typeof fetch;
}

function client(responses: (string | ((seen: Seen) => string))[], seen: Seen[] = []) {
  let t = 1_789_600_000_000;
  return createKrakenClient({
    key: "test-key",
    secret: SECRET,
    fetch: fakeFetch(responses, seen),
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
  });
}

function ledgerPage(count: number, ids: string[]) {
  return JSON.stringify({
    error: [],
    result: {
      count,
      ledger: Object.fromEntries(
        ids.map((id, n) => [
          id,
          {
            refid: `REF-${id}`,
            time: 1_780_000_000 + n,
            type: "trade",
            subtype: "",
            aclass: "currency",
            asset: "XXBT",
            amount: "0.0010000000",
            fee: "0.0000000000",
            balance: "0.0010000000",
          },
        ]),
      ),
    },
  });
}

describe("Kraken client", () => {
  it("signs requests the way Kraken's documentation does", () => {
    // Worked example from docs.kraken.com (spot REST authentication guide).
    const sign = signRequest(
      "/0/private/AddOrder",
      "1616492376594",
      "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25",
      "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==",
    );
    expect(sign).toBe(
      "4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==",
    );
  });

  it("reads a key's permissions from the recorded response", async () => {
    const seen: Seen[] = [];
    const info = await client([recorded("get-api-key-info.json")], seen).keyInfo();
    expect(info).toEqual({ permissions: ["query-funds", "query-ledger"], ipAllowlist: [] });
    expect(seen[0]!.url).toBe("https://api.kraken.com/0/private/GetApiKeyInfo");
    expect(seen[0]!.headers["API-Key"]).toBe("test-key");
    const nonce = /^nonce=(\d+)$/.exec(seen[0]!.body)![1]!;
    expect(seen[0]!.headers["API-Sign"]).toBe(
      signRequest("/0/private/GetApiKeyInfo", nonce, seen[0]!.body, SECRET),
    );
  });

  it("reads an empty account", async () => {
    expect(await client([recorded("balance-ex-empty.json")]).balances()).toEqual([]);
    const entries = [];
    for await (const entry of client([recorded("ledgers-empty.json")]).ledger())
      entries.push(entry);
    expect(entries).toEqual([]);
  });

  it("parses balances, including staked suffixes and held amounts", async () => {
    const body = JSON.stringify({
      error: [],
      result: {
        XXBT: { balance: "0.0100000000", hold_trade: "0.0000000000" },
        "DOT.S": { balance: "12.5000000000", hold_trade: "0.0000000000" },
        ZGBP: { balance: "20.5000", credit: "0.0000", credit_used: "0.0000", hold_trade: "5.0000" },
      },
    });
    expect(await client([body]).balances()).toEqual([
      { asset: "XXBT", balance: 0.01, holdTrade: 0 },
      { asset: "DOT.S", balance: 12.5, holdTrade: 0 },
      { asset: "ZGBP", balance: 20.5, holdTrade: 5 },
    ]);
  });

  it("follows ledger pages by offset until the count is reached", async () => {
    const first = Array.from({ length: 50 }, (_, n) => `L${n}`);
    const seen: Seen[] = [];
    const entries = [];
    for await (const entry of client(
      [ledgerPage(52, first), ledgerPage(52, ["L50", "L51"])],
      seen,
    ).ledger()) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(52);
    expect(entries[0]).toMatchObject({ id: "L0", asset: "XXBT", amount: 0.001, balance: 0.001 });
    expect(entries[0]!.time).toEqual(new Date(1_780_000_000_000));
    expect(seen.map((s) => new URLSearchParams(s.body).get("ofs"))).toEqual(["0", "50"]);
  });

  it("sends strictly increasing nonces, one call at a time", async () => {
    const seen: Seen[] = [];
    const c = client([recorded("balance-ex-empty.json")], seen);
    await Promise.all([c.balances(), c.balances(), c.balances()]);
    const nonces = seen.map((s) => BigInt(new URLSearchParams(s.body).get("nonce")!));
    expect(nonces[1]! > nonces[0]!).toBe(true);
    expect(nonces[2]! > nonces[1]!).toBe(true);
  });

  it("maps Kraken's errors", async () => {
    await expect(client([recorded("invalid-key.json")]).balances()).rejects.toBeInstanceOf(
      KrakenAuthError,
    );
    const denied = client([recorded("permission-denied.json")]).balances();
    await expect(denied).rejects.toBeInstanceOf(KrakenPermissionError);
    await expect(denied).rejects.toMatchObject({ permission: "Query Funds" });
    await expect(client(['{"error":["EService:Unavailable"]}']).balances()).rejects.toBeInstanceOf(
      KrakenUnavailableError,
    );
    await expect(client(["not json"]).balances()).rejects.toBeInstanceOf(KrakenShapeError);
  });

  it("waits and retries when rate limited, then gives up", async () => {
    const limited = '{"error":["EAPI:Rate limit exceeded"]}';
    expect(await client([limited, recorded("balance-ex-empty.json")]).balances()).toEqual([]);
    await expect(client([limited]).balances()).rejects.toBeInstanceOf(KrakenUnavailableError);
  });

  it("has no way to trade, withdraw, deposit or earn", () => {
    const source = readFileSync(resolve(import.meta.dirname, "client.ts"), "utf8");
    expect(source).not.toMatch(/Order|Withdraw|Deposit|Cancel|Earn|Stake|Transfer|WebSocketsToken/);
  });
});

describe("Kraken key permissions", () => {
  it("accepts exactly the two read permissions Pip needs", () => {
    expect(checkKrakenPermissions(["query-funds", "query-ledger"])).toEqual({
      ok: true,
      missing: [],
      forbidden: [],
    });
  });

  it("allows other query-only permissions", () => {
    expect(
      checkKrakenPermissions([
        "query-funds",
        "query-ledger",
        "query-open-trades",
        "query-closed-trades",
        "export-data",
      ]).ok,
    ).toBe(true);
  });

  it("refuses keys that can move money, and names what to untick", () => {
    const check = checkKrakenPermissions([
      "query-funds",
      "query-ledger",
      "modify-trades",
      "withdraw-funds",
      "earn-funds",
    ]);
    expect(check.ok).toBe(false);
    expect(check.forbidden).toEqual(["modify-trades", "withdraw-funds", "earn-funds"]);
  });

  it("refuses permissions it doesn't know", () => {
    expect(
      checkKrakenPermissions(["query-funds", "query-ledger", "something-new"]).forbidden,
    ).toEqual(["something-new"]);
  });

  it("names missing permissions", () => {
    expect(checkKrakenPermissions(["query-funds"]).missing).toEqual(["query-ledger"]);
  });
});

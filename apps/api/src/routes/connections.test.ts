import type { ConnectResult } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { memorySessionStore, sessionCookieName } from "../auth/session.js";
import { inspectKey } from "./connections.js";

const COOKIE = sessionCookieName(false);
const SIGNED_IN = { cookie: `${COOKIE}=live-token` };

function appForTests() {
  return buildApp({
    sessionStore: memorySessionStore({
      "live-token": { id: "user-1", email: "test@example.com", name: "Waqar" },
    }),
  });
}

async function connect(key: string, provider = "kraken") {
  const response = await appForTests().inject({
    method: "POST",
    url: `/connections/${provider}`,
    headers: SIGNED_IN,
    payload: { key },
  });
  return { status: response.statusCode, body: response.json() as ConnectResult };
}

describe("inspecting a key", () => {
  it("accepts one that can only look", () => {
    expect(inspectKey("kraken", "read-only-key-0123456789").outcome).toBe("connected");
  });

  it("refuses one that can trade or withdraw, rather than warning about it", () => {
    for (const key of [
      "key-with-trade-scope-0123",
      "key-with-withdraw-0123456",
      "KEY-TRADE-01234567890",
    ]) {
      const result = inspectKey("kraken", key);

      expect(result.outcome).toBe("too_much_access");
      expect(result.permissions?.find((p) => p.name === "Query funds")?.required).toBe(true);
      expect(result.permissions?.filter((p) => !p.required)).toHaveLength(2);
    }
  });

  it("treats something too short to be a key as a typo, not a refusal", () => {
    expect(inspectKey("kraken", "abc").outcome).toBe("invalid_key");
    expect(inspectKey("kraken", "   ").outcome).toBe("invalid_key");
  });

  it("names the provider in its explanation", () => {
    expect(inspectKey("trading212", "abc").message).toContain("Trading 212");
    expect(inspectKey("kraken", "abc").message).toContain("Kraken");
  });

  it("says plainly that nothing was changed when a key is rejected", () => {
    expect(inspectKey("kraken", "abc").message).toContain("nothing was changed");
  });
});

describe("POST /connections/:provider", () => {
  it("needs a session", async () => {
    const response = await appForTests().inject({
      method: "POST",
      url: "/connections/kraken",
      payload: { key: "read-only-key-0123456789" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("answers 200 for every verdict, because each is an answer about the key", async () => {
    for (const key of ["read-only-key-0123456789", "key-with-trade-scope-0123", "abc"]) {
      const { status } = await connect(key);
      expect(status).toBe(200);
    }
  });

  it("returns the verdict the inspector reached", async () => {
    await expect(connect("read-only-key-0123456789")).resolves.toMatchObject({
      body: { outcome: "connected", provider: "kraken" },
    });
    await expect(connect("key-with-withdraw-0123456")).resolves.toMatchObject({
      body: { outcome: "too_much_access" },
    });
  });

  it("stores nothing — the connections list is unchanged by connecting", async () => {
    const app = appForTests();
    const before = await app.inject({ method: "GET", url: "/connections", headers: SIGNED_IN });

    await app.inject({
      method: "POST",
      url: "/connections/kraken",
      headers: SIGNED_IN,
      payload: { key: "read-only-key-0123456789" },
    });

    const after = await app.inject({ method: "GET", url: "/connections", headers: SIGNED_IN });
    expect(after.json()).toEqual(before.json());
  });

  it("404s on a provider this phase doesn't support", async () => {
    const { status } = await connect("read-only-key-0123456789", "coinbase");
    expect(status).toBe(404);
  });
});

describe("DELETE /connections/:provider", () => {
  it("needs a session", async () => {
    const response = await appForTests().inject({ method: "DELETE", url: "/connections/kraken" });
    expect(response.statusCode).toBe(401);
  });

  it("succeeds without having anything to remove", async () => {
    const response = await appForTests().inject({
      method: "DELETE",
      url: "/connections/kraken",
      headers: SIGNED_IN,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "disconnected", provider: "kraken" });
  });

  it("404s on an unknown provider", async () => {
    const response = await appForTests().inject({
      method: "DELETE",
      url: "/connections/coinbase",
      headers: SIGNED_IN,
    });

    expect(response.statusCode).toBe(404);
  });
});

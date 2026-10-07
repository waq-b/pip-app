import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { memoryNetAssetsStore } from "../rules/net-assets.js";
import { testAuth } from "../test-support/auth.js";

/**
 * Net assets: the most sensitive figure Pip holds. It
 * sets Side Bet's limit and nothing else, and neither it nor the limit comes
 * back unless it's asked for outright — the limit gives the figure away ten
 * times over.
 */

const NOW = new Date("2026-09-17T09:00:00Z");

function setup() {
  const auth = testAuth(["test@example.com", "friend@example.test"]);
  const store = memoryNetAssetsStore();
  const app = buildApp({ ...auth.options, netAssets: store, now: () => NOW });
  const waqar = auth.headersFor("test@example.com");
  const call = (
    method: "GET" | "PUT" | "POST",
    url: string,
    payload?: unknown,
    headers: Record<string, string> = waqar,
  ) =>
    app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return { auth, store, call, friend: auth.headersFor("friend@example.test") };
}

describe("net assets", () => {
  it.each([
    ["GET", "/net-assets"],
    ["PUT", "/net-assets"],
    ["POST", "/net-assets/reveal"],
  ] as const)("%s %s needs a session", async (method, url) => {
    const { call } = setup();
    expect((await call(method, url, {}, {})).statusCode).toBe(401);
  });

  it("starts unset, on the starter limit", async () => {
    const { call } = setup();
    expect((await call("GET", "/net-assets")).json()).toEqual({
      set: false,
      starterLimit: true,
      dueReview: false,
    });
  });

  it("says only that it's set, never the figure, on an ordinary read", async () => {
    const { call } = setup();
    await call("PUT", "/net-assets", { pounds: 64_000 });

    const response = await call("GET", "/net-assets");
    expect(response.json()).toEqual({
      set: true,
      starterLimit: false,
      reviewedAt: NOW.toISOString(),
      dueReview: false,
    });
    // Neither the figure nor the limit, which is the figure over ten.
    expect(response.body).not.toContain("64000");
    expect(response.body).not.toContain("640000");
  });

  it("gives the figure and the limit back when the eye asks", async () => {
    const { call } = setup();
    await call("PUT", "/net-assets", { pounds: 64_000 });

    expect((await call("POST", "/net-assets/reveal")).json()).toEqual({
      set: true,
      starterLimit: false,
      pounds: 64_000,
      limit: 640_000,
    });
  });

  it("answers the reveal with the starter limit when nothing is set", async () => {
    const { call } = setup();
    expect((await call("POST", "/net-assets/reveal")).json()).toEqual({
      set: false,
      starterLimit: true,
      limit: 35_000,
    });
  });

  it("hands the new limit straight back when it's just been typed", async () => {
    const { call } = setup();
    expect((await call("PUT", "/net-assets", { pounds: 250_000 })).json()).toEqual({
      set: true,
      starterLimit: false,
      pounds: 250_000,
      limit: 2_500_000,
      reviewedAt: NOW.toISOString(),
      dueReview: false,
    });
  });

  it.each([
    ["pence", { pounds: 64_000.5 }, "invalid_amount"],
    ["words", { pounds: "64000" }, "invalid_amount"],
    ["nothing", {}, "invalid_amount"],
    ["a negative figure", { pounds: -1 }, "amount_out_of_range"],
    ["more than anyone has", { pounds: 10_000_000_001 }, "amount_out_of_range"],
  ])("refuses %s", async (_name, payload, error) => {
    const { call } = setup();
    const response = await call("PUT", "/net-assets", payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
  });

  it("asks for a check a year on, and not before", async () => {
    const { call, store, auth } = setup();
    const user = { userId: auth.userIdFor("test@example.com"), authUserId: "auth" };
    await store.set(user, 6_400_000, new Date("2025-09-18T09:00:00Z"));
    expect((await call("GET", "/net-assets")).json()).toMatchObject({ dueReview: false });

    await store.set(user, 6_400_000, new Date("2025-09-17T09:00:00Z"));
    expect((await call("GET", "/net-assets")).json()).toMatchObject({ dueReview: true });
  });

  it("is one person's own: nobody else's figure comes back", async () => {
    const { call, friend } = setup();
    await call("PUT", "/net-assets", { pounds: 64_000 });

    expect((await call("GET", "/net-assets", undefined, friend)).json()).toMatchObject({
      set: false,
    });
    expect((await call("POST", "/net-assets/reveal", undefined, friend)).json()).toEqual({
      set: false,
      starterLimit: true,
      limit: 35_000,
    });
  });
});

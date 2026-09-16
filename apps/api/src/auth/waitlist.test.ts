import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testAuth } from "../test-support/auth.js";

function setup() {
  const auth = testAuth(["test@example.com"]);
  return { auth, app: buildApp(auth.options) };
}

describe("GET /me", () => {
  it("needs a token", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
  });

  it("tells an allowlisted person they're in", async () => {
    const { app, auth } = setup();
    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: auth.headersFor("test@example.com", "Waqar"),
    });

    expect(response.json()).toEqual({ email: "test@example.com", name: "Waqar", allowed: true });
  });

  it("is reachable by someone not on the list, so they can find out", async () => {
    const { app, auth } = setup();
    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: auth.headersFor("sam@example.com"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ allowed: false });
  });

  it("links an allowlisted row to their Supabase identity on first arrival", async () => {
    const { app, auth } = setup();
    await app.inject({ method: "GET", url: "/me", headers: auth.headersFor("test@example.com") });

    expect(auth.allowlistStore.rows.get("test@example.com")?.authUserId).toBe(
      "auth-test@example.com",
    );
  });
});

describe("POST /waitlist", () => {
  it("needs a token", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "POST", url: "/waitlist", payload: {} })).statusCode).toBe(
      401,
    );
  });

  it("adds the address from the token, never from the body", async () => {
    const { app, auth } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/waitlist",
      headers: auth.headersFor("sam@example.com", "Sam"),
      payload: { email: "attacker@example.com" },
    });

    expect(response.statusCode).toBe(200);
    expect([...auth.waitlistStore.entries.keys()]).toEqual(["sam@example.com"]);
  });

  it("treats asking twice as fine, and keeps the first ask", async () => {
    const { app, auth } = setup();
    const headers = auth.headersFor("sam@example.com", "Sam");

    await app.inject({ method: "POST", url: "/waitlist", headers });
    await app.inject({
      method: "POST",
      url: "/waitlist",
      headers: auth.headersFor("sam@example.com", "Samuel"),
    });

    expect(auth.waitlistStore.entries.size).toBe(1);
    expect(auth.waitlistStore.entries.get("sam@example.com")).toBe("Sam");
  });
});

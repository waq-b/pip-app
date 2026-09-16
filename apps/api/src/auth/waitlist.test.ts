import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { isPublicPath } from "./guard.js";
import { memoryWaitlistStore } from "./waitlist.js";
import { signWaitlistToken, verifyWaitlistToken, WAITLIST_TOKEN_TTL_MS } from "./waitlist-token.js";

const SECRET = "test-secret-at-least-32-characters-long";

describe("the waitlist token", () => {
  it("round-trips the address Google verified", () => {
    const token = signWaitlistToken({ email: "sam@example.com", name: "Sam" }, SECRET);
    expect(verifyWaitlistToken(token, SECRET)).toMatchObject({
      email: "sam@example.com",
      name: "Sam",
    });
  });

  it("refuses a token signed with a different secret", () => {
    const token = signWaitlistToken({ email: "sam@example.com" }, "another-secret-entirely");
    expect(verifyWaitlistToken(token, SECRET)).toBeNull();
  });

  it("refuses a tampered payload", () => {
    const token = signWaitlistToken({ email: "sam@example.com" }, SECRET);
    const forged = Buffer.from(JSON.stringify({ email: "attacker@example.com" })).toString(
      "base64url",
    );
    expect(verifyWaitlistToken(`${forged}.${token.split(".")[1]}`, SECRET)).toBeNull();
  });

  it("expires", () => {
    const issued = Date.now();
    const token = signWaitlistToken({ email: "sam@example.com" }, SECRET, issued);

    expect(
      verifyWaitlistToken(token, SECRET, issued + WAITLIST_TOKEN_TTL_MS - 1000),
    ).not.toBeNull();
    expect(verifyWaitlistToken(token, SECRET, issued + WAITLIST_TOKEN_TTL_MS + 1000)).toBeNull();
  });

  it("refuses junk", () => {
    expect(verifyWaitlistToken("", SECRET)).toBeNull();
    expect(verifyWaitlistToken("no-separator", SECRET)).toBeNull();
    expect(verifyWaitlistToken(".", SECRET)).toBeNull();
    expect(verifyWaitlistToken("not-base64.signature", SECRET)).toBeNull();
  });
});

describe("POST /waitlist", () => {
  function appWith() {
    const store = memoryWaitlistStore();
    const app = buildApp({ waitlistStore: store, authSecret: SECRET });
    return { app, store };
  }

  it("is reachable without a session, but not without a token", async () => {
    const { app } = appWith();
    const response = await app.inject({ method: "POST", url: "/waitlist", payload: {} });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "missing_token" });
  });

  it("refuses a forged token", async () => {
    const { app, store } = appWith();
    const token = signWaitlistToken({ email: "attacker@example.com" }, "wrong-secret");
    const response = await app.inject({ method: "POST", url: "/waitlist", payload: { token } });

    expect(response.statusCode).toBe(401);
    expect(store.entries.size).toBe(0);
  });

  it("adds the address from inside the token, never from the body", async () => {
    const { app, store } = appWith();
    const token = signWaitlistToken({ email: "sam@example.com", name: "Sam" }, SECRET);
    const response = await app.inject({
      method: "POST",
      url: "/waitlist",
      payload: { token, email: "attacker@example.com" },
    });

    expect(response.statusCode).toBe(200);
    expect([...store.entries.keys()]).toEqual(["sam@example.com"]);
  });

  it("treats asking twice as fine, and keeps the first ask", async () => {
    const { app, store } = appWith();
    const token = signWaitlistToken({ email: "sam@example.com", name: "Sam" }, SECRET);

    await app.inject({ method: "POST", url: "/waitlist", payload: { token } });
    await app.inject({ method: "POST", url: "/waitlist", payload: { token } });

    expect(store.entries.size).toBe(1);
    expect(store.entries.get("sam@example.com")).toBe("Sam");
  });

  it("does not exist at all when no secret is configured", async () => {
    const app = buildApp({ waitlistStore: memoryWaitlistStore() });
    const response = await app.inject({ method: "POST", url: "/waitlist", payload: {} });

    expect(response.statusCode).toBe(404);
  });

  it("is the only session-free route besides health and the login flow", () => {
    expect(isPublicPath("/waitlist")).toBe(true);
    expect(isPublicPath("/portfolio")).toBe(false);
  });
});

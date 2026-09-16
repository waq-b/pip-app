import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testAuth } from "../test-support/auth.js";
import { bearerToken, isPublicPath } from "./guard.js";

describe("bearerToken", () => {
  it("reads the token from an Authorization header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer abc")).toBe("abc");
  });

  it("returns nothing for anything else", () => {
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken("Bearer")).toBeUndefined();
  });
});

describe("isPublicPath", () => {
  it("exempts health and nothing else", () => {
    expect(isPublicPath("/health")).toBe(true);
    for (const path of ["/portfolio", "/me", "/waitlist", "/healthcheck", "/auth/session"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});

describe("the two walls", () => {
  function setup() {
    const auth = testAuth(["test@example.com"]);
    const app = buildApp(auth.options);
    app.get("/protected", async (request) => ({ email: request.allowedUser?.email }));
    return { auth, app };
  }

  it("refuses a request with no token", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "GET", url: "/protected" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("refuses a token that doesn't verify", async () => {
    const { app } = setup();
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer forged" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("tells a verified stranger they're not on the list", async () => {
    const { app, auth } = setup();
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: auth.headersFor("stranger@example.com"),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "not_on_the_list" });
  });

  it("lets an allowlisted person through, matching email case-insensitively", async () => {
    const { app, auth } = setup();
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: auth.headersFor("Test@Example.com"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: "test@example.com" });
  });

  it("guards a query string the same as a bare path", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/protected?tf=day" })).statusCode).toBe(401);
  });

  it("fails closed when no verifier is configured", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/portfolio",
      headers: { authorization: "Bearer anything" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("still answers /health without a token", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("route coverage", () => {
  /**
   * The rule, enforced rather than remembered: every route the app registers
   * either is `/health` or answers 401 without a token. This walks the real
   * route table, so a new unprotected route fails it without anyone adding a
   * case here.
   */
  it("leaves no route unprotected", async () => {
    const routes: { method: string; url: string }[] = [];
    const app = buildApp(testAuth().options);
    app.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (method === "HEAD" || method === "OPTIONS") continue;
        routes.push({ method, url: route.url });
      }
    });
    app.get("/protected", async () => ({ ok: true }));
    await app.ready();

    const checked: string[] = [];
    for (const route of routes) {
      if (isPublicPath(route.url)) continue;
      const url = route.url.replace(/:\w+/g, "1");
      const response = await app.inject({ method: route.method as "GET", url });

      expect(response.statusCode, `${route.method} ${url} answered without a token`).toBe(401);
      checked.push(`${route.method} ${url}`);
    }

    // Fails rather than passing vacuously if the table is ever empty.
    expect(checked.length).toBeGreaterThan(0);
  });
});

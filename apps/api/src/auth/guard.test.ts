import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { isPublicPath, readCookie } from "./guard.js";
import { memorySessionStore, sessionCookieName } from "./session.js";

const COOKIE = sessionCookieName(false);
const store = memorySessionStore({
  "live-token": { id: "user-1", email: "test@example.com", name: "Waqar" },
});

function appWithProtectedRoute() {
  const app = buildApp({ sessionStore: store });
  app.get("/protected", async (request) => ({ email: request.sessionUser?.email }));
  return app;
}

describe("readCookie", () => {
  it("finds the named cookie among others", () => {
    expect(readCookie(`other=1; ${COOKIE}=abc; another=2`, COOKIE)).toBe("abc");
  });

  it("keeps a value containing '='", () => {
    expect(readCookie(`${COOKIE}=ab==`, COOKIE)).toBe("ab==");
  });

  it("returns nothing when the header is absent or the cookie is missing", () => {
    expect(readCookie(undefined, COOKIE)).toBeUndefined();
    expect(readCookie("other=1", COOKIE)).toBeUndefined();
  });
});

describe("isPublicPath", () => {
  it("exempts health and the login flow, and nothing else", () => {
    expect(isPublicPath("/health")).toBe(true);
    expect(isPublicPath("/auth/session")).toBe(true);
    expect(isPublicPath("/auth")).toBe(true);
    expect(isPublicPath("/portfolio")).toBe(false);
    expect(isPublicPath("/healthcheck")).toBe(false);
    // A path that merely starts with the word must not slip through.
    expect(isPublicPath("/authorised")).toBe(false);
  });
});

describe("the session guard", () => {
  it("refuses a protected route with no cookie", async () => {
    const response = await appWithProtectedRoute().inject({ method: "GET", url: "/protected" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("refuses a token the store doesn't know", async () => {
    const response = await appWithProtectedRoute().inject({
      method: "GET",
      url: "/protected",
      headers: { cookie: `${COOKIE}=made-up` },
    });

    expect(response.statusCode).toBe(401);
  });

  it("lets a live session through and hands the route its user", async () => {
    const response = await appWithProtectedRoute().inject({
      method: "GET",
      url: "/protected",
      headers: { cookie: `${COOKIE}=live-token` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: "test@example.com" });
  });

  it("still answers /health without a session", async () => {
    const response = await buildApp({ sessionStore: store }).inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
  });

  it("guards a query string the same as a bare path", async () => {
    const response = await appWithProtectedRoute().inject({
      method: "GET",
      url: "/protected?tf=day",
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("route coverage", () => {
  /**
   * The rule, enforced rather than remembered: every route the app registers
   * either is `/health`, belongs to the login flow, or answers 401 without a
   * session. This test walks the real route table, so a new unprotected route
   * fails it without anyone having to add a case here.
   */
  it("leaves no route unprotected", async () => {
    const routes: { method: string; url: string }[] = [];
    const app = buildApp({ sessionStore: store });
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
      const url = route.url.replace(/:\w+/g, "1").replace(/\/\*$/, "/x");
      const response = await app.inject({ method: route.method as "GET", url });

      expect(response.statusCode, `${route.method} ${url} answered without a session`).toBe(401);
      checked.push(`${route.method} ${url}`);
    }

    // Guards the guard: if the route table is ever empty this test must fail
    // rather than pass vacuously.
    expect(checked.length).toBeGreaterThan(0);
  });
});

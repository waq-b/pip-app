import { randomUUID } from "node:crypto";
import type { Adapter, AdapterSession, AdapterUser } from "@auth/core/adapters";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { memoryAllowlistStore } from "./allowlist.js";
import { buildAuthConfig } from "./config.js";
import { authPlugin } from "./plugin.js";

/**
 * Auth.js validates the adapter before it will answer anything, so database
 * sessions need a real one even to serve `/auth/providers`. This is the whole
 * adapter surface, in memory — no Postgres, no sockets (CLAUDE.md hard line 7).
 */
function memoryAdapter(): Adapter {
  const users = new Map<string, AdapterUser>();
  const sessions = new Map<string, AdapterSession>();

  return {
    async createUser(user) {
      const created = { ...user, id: user.id || randomUUID() } as AdapterUser;
      users.set(created.id, created);
      return created;
    },
    async getUser(id) {
      return users.get(id) ?? null;
    },
    async getUserByEmail(email) {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async getUserByAccount() {
      return null;
    },
    async updateUser(user) {
      const existing = users.get(user.id as string);
      const merged = { ...existing, ...user } as AdapterUser;
      users.set(merged.id, merged);
      return merged;
    },
    async linkAccount() {
      return undefined;
    },
    async createSession(session) {
      sessions.set(session.sessionToken, session);
      return session;
    },
    async getSessionAndUser(sessionToken) {
      const session = sessions.get(sessionToken);
      if (!session) return null;
      const user = users.get(session.userId);
      if (!user) return null;
      return { session, user };
    },
    async updateSession(session) {
      const existing = sessions.get(session.sessionToken);
      if (!existing) return null;
      const merged = { ...existing, ...session };
      sessions.set(merged.sessionToken, merged);
      return merged;
    },
    async deleteSession(sessionToken) {
      sessions.delete(sessionToken);
      return undefined;
    },
  };
}

/** Exercises the Fastify ↔ Web Request plumbing with no database and no network. */
async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(authPlugin, {
    config: buildAuthConfig({
      store: memoryAllowlistStore(["test@example.com"]),
      adapter: memoryAdapter(),
      secret: "test-secret-at-least-32-characters-long",
      googleClientId: "id",
      googleClientSecret: "secret",
      useSecureCookies: false,
    }),
  });
  return app;
}

describe("auth routes", () => {
  it("serves the provider list, proving the handler is mounted", async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: "GET", url: "/auth/providers" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("google");
  });

  it("offers Google and nothing else", async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: "GET", url: "/auth/providers" });

    expect(Object.keys(response.json())).toEqual(["google"]);
  });

  it("issues a CSRF token, and sets it as a cookie", async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: "GET", url: "/auth/csrf" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("csrfToken");
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("reports no session when there is no cookie", async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: "GET", url: "/auth/session" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(null);
  });
});

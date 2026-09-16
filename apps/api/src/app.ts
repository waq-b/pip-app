import type { AuthConfig } from "@auth/core";
import Fastify from "fastify";
import { dbSessionStore, type SessionStore } from "./auth/session.js";
import { registerSessionGuard } from "./auth/guard.js";
import { authPlugin } from "./auth/plugin.js";

export interface BuildAppOptions {
  /**
   * Omitted in tests, which keeps the app startable with no environment and no
   * database. `server.ts` always passes one.
   */
  authConfig?: AuthConfig;
  /** Tests inject an in-memory store; production reads sessions from Postgres. */
  sessionStore?: SessionStore;
  useSecureCookies?: boolean;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false });

  // The guard goes on first and covers everything registered afterwards, so a
  // route is protected by existing rather than by anyone remembering to
  // protect it (CLAUDE.md hard line 4).
  registerSessionGuard(app, {
    store: options.sessionStore ?? dbSessionStore,
    useSecureCookies: options.useSecureCookies ?? false,
  });

  // One of the two exemptions; the other is the login flow itself.
  app.get("/health", async () => ({ status: "ok" }));

  if (options.authConfig) {
    void app.register(authPlugin, { config: options.authConfig });
  }

  return app;
}

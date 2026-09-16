import type { AuthConfig } from "@auth/core";
import Fastify from "fastify";
import { registerSessionGuard } from "./auth/guard.js";
import { authPlugin } from "./auth/plugin.js";
import { dbSessionStore, type SessionStore } from "./auth/session.js";
import { registerWaitlistRoute } from "./auth/waitlist-route.js";
import { dbWaitlistStore, type WaitlistStore } from "./auth/waitlist.js";

export interface BuildAppOptions {
  /**
   * Omitted in tests, which keeps the app startable with no environment and no
   * database. `server.ts` always passes one.
   */
  authConfig?: AuthConfig;
  /** Tests inject in-memory stores; production reads from Postgres. */
  sessionStore?: SessionStore;
  waitlistStore?: WaitlistStore;
  /**
   * Signs and verifies waitlist tokens. Without it the waitlist route is not
   * registered at all — a route that can't verify its own token shouldn't
   * exist.
   */
  authSecret?: string;
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

  // One of the three exemptions; the others are the login flow and the
  // token-gated waitlist below.
  app.get("/health", async () => ({ status: "ok" }));

  if (options.authSecret) {
    registerWaitlistRoute(app, {
      store: options.waitlistStore ?? dbWaitlistStore,
      secret: options.authSecret,
    });
  }

  if (options.authConfig) {
    void app.register(authPlugin, { config: options.authConfig });
  }

  return app;
}

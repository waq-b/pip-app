import type { AuthConfig } from "@auth/core";
import Fastify from "fastify";
import { authPlugin } from "./auth/plugin.js";

export interface BuildAppOptions {
  /**
   * Omitted in tests, which keeps the app startable with no environment and no
   * database. `server.ts` always passes one.
   */
  authConfig?: AuthConfig;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false });

  // The only route that never needs a session (CLAUDE.md hard line 4).
  app.get("/health", async () => ({ status: "ok" }));

  if (options.authConfig) {
    void app.register(authPlugin, { config: options.authConfig });
  }

  return app;
}

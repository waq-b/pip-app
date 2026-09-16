import Fastify from "fastify";
import { dbAllowlistStore, type AllowlistStore } from "./auth/allowlist.js";
import { registerAuthGuard } from "./auth/guard.js";
import { refuseEveryone, type TokenVerifier } from "./auth/jwt.js";
import { registerMeRoute } from "./auth/me-route.js";
import { registerWaitlistRoute } from "./auth/waitlist-route.js";
import { dbWaitlistStore, type WaitlistStore } from "./auth/waitlist.js";
import type { MarketData } from "./market/market.js";
import { stubSeriesAnchors } from "./market/stub/anchors.js";
import { createStubMarketData } from "./market/stub/index.js";
import { registerConnectionRoutes } from "./routes/connections.js";
import { registerReadRoutes } from "./routes/read.js";

export interface BuildAppOptions {
  /**
   * Verifies Supabase tokens. Omitted, nobody gets in — a misconfigured server
   * fails closed. `server.ts` always passes the real one.
   */
  verifier?: TokenVerifier;
  /** Tests inject in-memory stores; production reads from Postgres. */
  allowlistStore?: AllowlistStore;
  waitlistStore?: WaitlistStore;
  /** Prices, history and freshness. Phase 1 has only the stub. */
  marketData?: MarketData;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false });
  const allowlist = options.allowlistStore ?? dbAllowlistStore;

  // The guard goes on first and covers everything registered afterwards, so a
  // route is protected by existing rather than by anyone remembering to
  // protect it (CLAUDE.md hard line 4).
  registerAuthGuard(app, { verifier: options.verifier ?? refuseEveryone, allowlist });

  // The one route that needs no token.
  app.get("/health", async () => ({ status: "ok" }));

  registerMeRoute(app, { allowlist });
  registerWaitlistRoute(app, { store: options.waitlistStore ?? dbWaitlistStore });
  registerReadRoutes(app, {
    market: options.marketData ?? createStubMarketData({ anchors: stubSeriesAnchors() }),
  });
  registerConnectionRoutes(app);

  return app;
}

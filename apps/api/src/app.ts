import Fastify, { type FastifyServerOptions } from "fastify";
import { dbAllowlistStore, type AllowlistStore } from "./auth/allowlist.js";
import { registerAuthGuard } from "./auth/guard.js";
import { registerJobRoutes } from "./jobs/routes.js";
import { refuseEveryone, type TokenVerifier } from "./auth/jwt.js";
import { registerMeRoute } from "./auth/me-route.js";
import { registerWaitlistRoute } from "./auth/waitlist-route.js";
import { dbWaitlistStore, type WaitlistStore } from "./auth/waitlist.js";
import type { MarketData } from "./market/market.js";
import { stubSeriesAnchors } from "./market/stub/anchors.js";
import { createStubMarketData } from "./market/stub/index.js";
import {
  registerConnectionRoutes,
  stubConnectionService,
  type ConnectionService,
} from "./routes/connections.js";
import type { ReadModel } from "./read/model.js";
import { stubReadModel } from "./read/stub.js";
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
  /** Stub-mode prices, history and freshness. */
  marketData?: MarketData;
  /** Real accounts (Trading 212 mode). Defaults to the stub sample data. */
  readModel?: ReadModel;
  /** Stub mode stores nothing; Trading 212 mode seals keys (`sync/connections.ts`). */
  connections?: ConnectionService;
  /** The scheduled refresh (Trading 212 mode). */
  refreshJob?: { run(): Promise<unknown> };
  /** From `JOB_SECRET`; job routes refuse everyone without it. */
  jobSecret?: string;
  /** Off in tests; `server.ts` passes the redacted production logger. */
  logger?: FastifyServerOptions["logger"];
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const allowlist = options.allowlistStore ?? dbAllowlistStore;

  // The guard goes on first and covers everything registered afterwards, so a
  // route is protected by existing rather than by anyone remembering to
  // protect it (CLAUDE.md hard line 4).
  registerAuthGuard(app, {
    verifier: options.verifier ?? refuseEveryone,
    allowlist,
    jobSecret: options.jobSecret,
  });

  // The one route that needs no token.
  app.get("/health", async () => ({ status: "ok" }));

  registerMeRoute(app, { allowlist });
  registerWaitlistRoute(app, { store: options.waitlistStore ?? dbWaitlistStore });
  registerReadRoutes(app, {
    model:
      options.readModel ??
      stubReadModel(options.marketData ?? createStubMarketData({ anchors: stubSeriesAnchors() })),
  });
  registerJobRoutes(app, { refresh: options.refreshJob });
  registerConnectionRoutes(app, { service: options.connections ?? stubConnectionService });

  return app;
}

import Fastify, { type FastifyServerOptions } from "fastify";
import { dbAllowlistStore, type AllowlistStore } from "./auth/allowlist.js";
import { registerAuthGuard } from "./auth/guard.js";
import { registerJobRoutes } from "./jobs/routes.js";
import { registerWebApp, rewriteForWebApp } from "./web.js";
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
import { memoryProfileStore, type ProfileStore } from "./nudges/profile.js";
import { registerResearchSettingsRoutes } from "./routes/research-settings.js";
import { registerRulesRoutes } from "./routes/rules.js";
import { memoryTrustSettingsStore, type TrustSettingsStore } from "./rules/trust-settings.js";
import { memoryRulesStore, type RulesStore } from "./rules/store.js";
import { stubFactsReader } from "./nudges/gather.js";
import { createNudgeService, type NudgeService } from "./nudges/service.js";
import { memoryNudgeStore } from "./nudges/store.js";
import { registerWeekRoutes } from "./routes/week.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerNetAssetsRoutes } from "./routes/net-assets.js";
import { fixedJobStatus, registerStatusRoutes, type JobStatusReader } from "./routes/status.js";
import { memoryNetAssetsStore, type NetAssetsStore } from "./rules/net-assets.js";
import { fixedSideBetLimits, type SideBetLimitReader } from "./rules/side-bet.js";
import { memoryNotificationStore, type NotificationStore } from "./notify/store.js";
import type { Notifier } from "./notify/notify.js";
import { stubWriter } from "./research/writer.js";

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
  /** Where a user's rules are kept. Stub mode keeps them in memory; real accounts in Postgres. */
  rulesStore?: RulesStore;
  /** Phase 5: the profile Pip writes for, and the user's trust rules. In memory unless given. */
  profileStore?: ProfileStore;
  trustSettingsStore?: TrustSettingsStore;
  /**
   * Your week. Stub mode builds one on read from the sample data, stub facts
   * and the stub writer, kept in memory; real accounts pass the database one.
   */
  nudges?: NudgeService;
  /** Notification settings, devices and the bell (Phase 6). */
  notifications?: NotificationStore;
  /** Sends pushes and emails, by the rules in `notify/notify.ts` (Phase 6). */
  notifier?: Notifier;
  /** The sealed net assets behind Side Bet's limit (Phase 6). */
  netAssets?: NetAssetsStore;
  /** What Side Bet is judged against (Phase 6); stub mode uses a fixed answer. */
  sideBetLimits?: SideBetLimitReader;
  /** What the jobs have been doing, for `/status` and `/health/jobs` (Phase 6). */
  jobStatus?: JobStatusReader;
  /** The scheduled refresh (Trading 212 mode). */
  refreshJob?: { run(): Promise<unknown> };
  /** From `JOB_SECRET`; job routes refuse everyone without it. */
  jobSecret?: string;
  /**
   * Built web app to serve from the same origin, with the API under `/api`
   * (production). Absent in dev (Vite serves the app) and tests.
   */
  webAppDir?: string;
  /** From `CANONICAL_HOST`: app pages asked for on any other host redirect here. */
  canonicalHost?: string;
  /** Frozen in tests, so a route's timestamps are predictable. */
  now?: () => Date;
  /** Off in tests; `server.ts` passes the redacted production logger. */
  logger?: FastifyServerOptions["logger"];
}

export function buildApp(options: BuildAppOptions = {}) {
  const serverOptions: FastifyServerOptions = { logger: options.logger ?? false };
  if (options.webAppDir) serverOptions.rewriteUrl = (req) => rewriteForWebApp(req.url ?? "/");
  const app = Fastify(serverOptions);
  const allowlist = options.allowlistStore ?? dbAllowlistStore;

  // The guard goes on first and covers everything registered afterwards, so a
  // route is protected by existing rather than by anyone remembering to
  // protect it (CLAUDE.md hard line 4).
  registerAuthGuard(app, {
    verifier: options.verifier ?? refuseEveryone,
    allowlist,
    jobSecret: options.jobSecret,
    servesWebApp: Boolean(options.webAppDir),
  });

  if (options.webAppDir)
    registerWebApp(app, options.webAppDir, { canonicalHost: options.canonicalHost });

  // The one route that needs no token.
  app.get("/health", async () => ({ status: "ok" }));

  registerMeRoute(app, { allowlist });
  registerWaitlistRoute(app, { store: options.waitlistStore ?? dbWaitlistStore });
  const rulesStore = options.rulesStore ?? memoryRulesStore();
  const sideBetLimits = options.sideBetLimits ?? fixedSideBetLimits({ moneyInPence: 40_000 });
  const netAssets = options.netAssets ?? memoryNetAssetsStore();
  const profileStore = options.profileStore ?? memoryProfileStore();
  const trustStore = options.trustSettingsStore ?? memoryTrustSettingsStore();
  const readModel =
    options.readModel ??
    stubReadModel(
      options.marketData ?? createStubMarketData({ anchors: stubSeriesAnchors() }),
      rulesStore,
    );
  registerReadRoutes(app, { model: readModel });
  registerRulesRoutes(app, { store: rulesStore });
  registerResearchSettingsRoutes(app, { profiles: profileStore, trust: trustStore });
  registerWeekRoutes(app, {
    service:
      options.nudges ??
      createNudgeService(
        {
          readModel,
          rulesStore,
          sideBetLimits,
          netAssets,
          trustStore,
          profileStore,
          facts: stubFactsReader(),
          store: memoryNudgeStore(),
          writer: stubWriter(),
        },
        { buildOnRead: true },
      ),
  });
  registerStatusRoutes(app, {
    jobs: options.jobStatus ?? fixedJobStatus(options.now),
    ...(options.now ? { now: options.now } : {}),
  });
  registerNetAssetsRoutes(app, {
    store: netAssets,
    ...(options.now ? { now: options.now } : {}),
  });
  registerNotificationRoutes(app, {
    store: options.notifications ?? memoryNotificationStore(),
    ...(options.now ? { now: options.now } : {}),
  });
  registerJobRoutes(app, { refresh: options.refreshJob });
  registerConnectionRoutes(app, { service: options.connections ?? stubConnectionService });

  return app;
}

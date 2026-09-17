import { buildApp, type BuildAppOptions } from "./app.js";
import { dbAllowlistStore } from "./auth/allowlist.js";
import { supabaseVerifierFromEnv } from "./auth/jwt.js";
import { dbWaitlistStore } from "./auth/waitlist.js";
import { loadConfig } from "./config.js";
import { getDb } from "./db/client.js";
import { liveFactsAdapters } from "./facts/live.js";
import { dbFactsReader } from "./nudges/gather.js";
import { groqChat } from "./nudges/groq-chat.js";
import { createNudgeService } from "./nudges/service.js";
import { dbNudgeStore } from "./nudges/store.js";
import { llmWriter, stubWriter } from "./research/writer.js";
import { createRefreshJob } from "./jobs/refresh-job.js";
import { LOG_REDACT_PATHS } from "./logging.js";
import { liveMarket } from "./market/live.js";
import { stubSeriesAnchors } from "./market/stub/anchors.js";
import { createStubMarketData } from "./market/stub/index.js";
import { parseStubStaleness } from "./market/stub/staleness-env.js";
import { krakenCoinIds, coinDetails } from "./market/sources/coingecko.js";
import { krakenAltnames, krakenGbpPair } from "./market/sources/kraken-public.js";
import { createKrakenClient } from "./providers/kraken/client.js";
import { createT212Client } from "./providers/t212/client.js";
import type { CoinDirectory } from "./sync/kraken.js";
import { liveReadModel } from "./read/live.js";
import { backfillHistory } from "./sync/backfill.js";
import { backfillKrakenHistory } from "./sync/kraken-history.js";
import { dbRulesStore } from "./rules/store.js";
import { dbProfileStore } from "./nudges/profile.js";
import { dbTrustSettingsStore } from "./rules/trust-settings.js";
import { liveConnectionService } from "./sync/connections.js";

const config = loadConfig();

const base: BuildAppOptions = {
  verifier: supabaseVerifierFromEnv(),
  allowlistStore: dbAllowlistStore,
  waitlistStore: dbWaitlistStore,
  jobSecret: config.jobSecret,
  // Production: serve the built web app from the same origin (see web.ts).
  webAppDir: process.env.WEB_DIST_DIR || undefined,
  canonicalHost: process.env.CANONICAL_HOST || undefined,
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: LOG_REDACT_PATHS, censor: "[redacted]" },
  },
};

function realAccounts(): Partial<BuildAppOptions> {
  // loadConfig guarantees a master key in this mode.
  const box = config.secretBox!;
  const db = getDb();
  const clientFor = (key: string, secret: string) => createT212Client({ key, secret, env: "demo" });
  const marketFor = liveMarket(db, {
    alphaVantageKey: config.alphaVantageKey,
    coinGeckoKey: config.coinGeckoKey,
  });

  // Kraken needs CoinGecko to name coins and find their prices; without the key it stays off.
  const coinGeckoKey = config.coinGeckoKey;
  const directory: CoinDirectory | undefined = coinGeckoKey
    ? {
        altnames: () => krakenAltnames(),
        coinIds: () => krakenCoinIds({ apiKey: coinGeckoKey }),
        details: (ids) => coinDetails({ apiKey: coinGeckoKey, ids }),
        gbpPair: (altname) => krakenGbpPair(altname),
      }
    : undefined;
  const kraken = directory
    ? { clientFor: (key: string, secret: string) => createKrakenClient({ key, secret }), directory }
    : undefined;

  const rulesStore = dbRulesStore(db);
  const profileStore = dbProfileStore(db);
  const trustSettingsStore = dbTrustSettingsStore(db);
  const readModel = liveReadModel({ db, marketFor, rulesStore });
  const nudges = createNudgeService({
    readModel,
    rulesStore,
    trustStore: trustSettingsStore,
    profileStore,
    facts: dbFactsReader(db),
    store: dbNudgeStore(db),
    writer:
      config.llm.mode === "groq"
        ? llmWriter({ chat: groqChat({ apiKey: config.llm.apiKey }), model: config.llm.model })
        : stubWriter(),
  });
  return {
    rulesStore,
    profileStore,
    trustSettingsStore,
    nudges,
    readModel,
    connections: liveConnectionService({
      db,
      box,
      keyVersion: config.masterKeyVersion,
      clientFor,
      kraken,
      // Rebuild history in the background; the scheduled job retries anything left pending.
      onConnected: (credential) => {
        if (credential.provider === "kraken") {
          if (directory) {
            void backfillKrakenHistory(db, credential, directory, marketFor).catch(() => undefined);
          }
          return;
        }
        void backfillHistory(db, box, credential, clientFor, marketFor).catch(() => undefined);
      },
    }),
    refreshJob: createRefreshJob({
      db,
      box,
      clientFor,
      kraken,
      marketFor,
      facts: liveFactsAdapters({
        alphaVantageKey: config.alphaVantageKey,
        marketauxKey: config.marketauxKey,
      }),
      nudges,
    }),
  };
}

const app = buildApp(
  config.providerMode === "t212"
    ? { ...base, ...realAccounts() }
    : {
        ...base,
        marketData: createStubMarketData({
          staleness: parseStubStaleness(process.env.STUB_STALENESS),
          anchors: stubSeriesAnchors(),
        }),
      },
);
const port = Number(process.env.PORT ?? 3001);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    app.log.info({ port, mode: config.providerMode }, "api listening");
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { LOG_REDACT_PATHS } from "./logging.js";
import { dbAllowlistStore } from "./auth/allowlist.js";
import { supabaseVerifierFromEnv } from "./auth/jwt.js";
import { dbWaitlistStore } from "./auth/waitlist.js";
import { stubSeriesAnchors } from "./market/stub/anchors.js";
import { createStubMarketData } from "./market/stub/index.js";
import { parseStubStaleness } from "./market/stub/staleness-env.js";

const config = loadConfig();
if (config.providerMode === "t212") {
  // Real Trading 212 data is wired up over Phase 2 (docs/phases/phase-2.md).
  // Until the read routes use it, refuse rather than quietly serve sample data.
  throw new Error("PROVIDER_MODE=t212 isn't wired up yet — run with PROVIDER_MODE=stub");
}

const app = buildApp({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: LOG_REDACT_PATHS, censor: "[redacted]" },
  },
  verifier: supabaseVerifierFromEnv(),
  allowlistStore: dbAllowlistStore,
  waitlistStore: dbWaitlistStore,
  marketData: createStubMarketData({
    staleness: parseStubStaleness(process.env.STUB_STALENESS),
    anchors: stubSeriesAnchors(),
  }),
});
const port = Number(process.env.PORT ?? 3001);

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(`api listening on :${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

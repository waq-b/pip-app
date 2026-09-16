import { secretBoxFromEnv, type SecretBox } from "./crypto/secrets.js";

/**
 * What the server runs against, read once at startup. Anything unsafe or
 * incomplete stops the process here rather than failing on the first request.
 */
export type ProviderMode = "stub" | "t212";

export interface ServerConfig {
  providerMode: ProviderMode;
  /** Master key version stamped on new seals. */
  masterKeyVersion: number;
  jobSecret?: string;
  alphaVantageKey?: string;
  /** CoinGecko Demo key — crypto prices (Phase 3). Without it, Kraken's public prices only. */
  coinGeckoKey?: string;
  /** Present whenever real provider keys can be stored or used. */
  secretBox?: SecretBox;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const mode = env.PROVIDER_MODE ?? "stub";
  if (mode !== "stub" && mode !== "t212") {
    throw new ConfigError(`PROVIDER_MODE must be "stub" or "t212", not "${mode}"`);
  }

  const secretBox = secretBoxFromEnv(env);
  // Real keys are never stored without encryption (hard line 6). Stub mode
  // stores none, so it can run without a master key.
  if (mode === "t212" && !secretBox) {
    throw new ConfigError(
      "PROVIDER_MODE=t212 needs MASTER_KEY — generate one with `pnpm --filter api master-key`",
    );
  }

  // Hard line 3: practice before live. Live arrives, read-only, in Phase 7.
  const t212Env = env.T212_ENV ?? "demo";
  if (mode === "t212" && t212Env !== "demo") {
    throw new ConfigError(`T212_ENV must be "demo" until Phase 7, not "${t212Env}"`);
  }
  if (env.JOB_SECRET !== undefined && env.JOB_SECRET.length > 0 && env.JOB_SECRET.length < 32) {
    throw new ConfigError("JOB_SECRET must be at least 32 characters");
  }

  return {
    providerMode: mode,
    secretBox,
    masterKeyVersion: Number(env.MASTER_KEY_VERSION ?? 1),
    jobSecret: env.JOB_SECRET || undefined,
    alphaVantageKey: env.AV_ACCESS_KEY || undefined,
    coinGeckoKey: env.COINGECKO_KEY || undefined,
  };
}

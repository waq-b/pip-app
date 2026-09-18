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
  /** Marketaux free key — news for Phase 5 facts. Without it, the other news sources only. */
  marketauxKey?: string;
  /** Present whenever real provider keys can be stored or used. */
  secretBox?: SecretBox;
  /**
   * Who writes nudges (Phase 5): `stub` (canned words, no network — the
   * default, and always in CI) or `groq`, which needs `GROQ_API_KEY`.
   */
  llm: { mode: "stub" } | { mode: "groq"; apiKey: string; model: string };
  /**
   * Who sends (Phase 6): `stub` records pushes and emails in memory — always in
   * CI and in stub mode — and `live` needs a VAPID pair and a Resend key.
   */
  notify:
    | { mode: "stub" }
    | {
        mode: "live";
        vapid: { publicKey: string; privateKey: string; subject: string };
        resendKey: string;
        emailFrom: string;
      };
}

export const DEFAULT_LLM_MODEL = "openai/gpt-oss-120b";

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

  // Hard line 3: practice before live. Live arrives, read-only, in Phase 8.
  const t212Env = env.T212_ENV ?? "demo";
  if (mode === "t212" && t212Env !== "demo") {
    throw new ConfigError(`T212_ENV must be "demo" until Phase 8, not "${t212Env}"`);
  }
  if (env.JOB_SECRET !== undefined && env.JOB_SECRET.length > 0 && env.JOB_SECRET.length < 32) {
    throw new ConfigError("JOB_SECRET must be at least 32 characters");
  }

  const llmMode = env.LLM_MODE ?? "stub";
  if (llmMode !== "stub" && llmMode !== "groq") {
    throw new ConfigError(`LLM_MODE must be "stub" or "groq", not "${llmMode}"`);
  }
  if (llmMode === "groq" && !env.GROQ_API_KEY) {
    throw new ConfigError("LLM_MODE=groq needs GROQ_API_KEY");
  }
  const notifyMode = env.NOTIFY_MODE ?? "stub";
  if (notifyMode !== "stub" && notifyMode !== "live") {
    throw new ConfigError(`NOTIFY_MODE must be "stub" or "live", not "${notifyMode}"`);
  }
  if (notifyMode === "live") {
    for (const name of [
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
      "RESEND_KEY",
      "EMAIL_FROM",
    ] as const) {
      if (!env[name]) throw new ConfigError(`NOTIFY_MODE=live needs ${name}`);
    }
    if (!env.VAPID_SUBJECT!.startsWith("mailto:")) {
      throw new ConfigError("VAPID_SUBJECT must be a mailto: address");
    }
  }
  const notify: ServerConfig["notify"] =
    notifyMode === "live"
      ? {
          mode: "live",
          vapid: {
            publicKey: env.VAPID_PUBLIC_KEY!,
            privateKey: env.VAPID_PRIVATE_KEY!,
            subject: env.VAPID_SUBJECT!,
          },
          resendKey: env.RESEND_KEY!,
          emailFrom: env.EMAIL_FROM!,
        }
      : { mode: "stub" };

  const llm: ServerConfig["llm"] =
    llmMode === "groq"
      ? { mode: "groq", apiKey: env.GROQ_API_KEY!, model: env.LLM_MODEL || DEFAULT_LLM_MODEL }
      : { mode: "stub" };

  return {
    providerMode: mode,
    llm,
    notify,
    secretBox,
    masterKeyVersion: Number(env.MASTER_KEY_VERSION ?? 1),
    jobSecret: env.JOB_SECRET || undefined,
    alphaVantageKey: env.AV_ACCESS_KEY || undefined,
    coinGeckoKey: env.COINGECKO_KEY || undefined,
    marketauxKey: env.MARKETAUX_API || undefined,
  };
}

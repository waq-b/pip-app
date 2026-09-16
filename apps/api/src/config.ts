import { secretBoxFromEnv, type SecretBox } from "./crypto/secrets.js";

/**
 * What the server runs against, read once at startup. Anything unsafe or
 * incomplete stops the process here rather than failing on the first request.
 */
export type ProviderMode = "stub" | "t212";

export interface ServerConfig {
  providerMode: ProviderMode;
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

  return { providerMode: mode, secretBox };
}

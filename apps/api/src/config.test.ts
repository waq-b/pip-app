import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { generateMasterKey } from "./crypto/secrets.js";

describe("server config", () => {
  it("defaults to stub mode, which needs no master key", () => {
    expect(loadConfig({})).toEqual({ providerMode: "stub", secretBox: undefined });
  });

  it("refuses to run against real providers without a master key", () => {
    expect(() => loadConfig({ PROVIDER_MODE: "t212" })).toThrow(/needs MASTER_KEY/);
  });

  it("runs against real providers with one", () => {
    const config = loadConfig({ PROVIDER_MODE: "t212", MASTER_KEY: generateMasterKey() });
    expect(config.providerMode).toBe("t212");
    expect(config.secretBox).toBeDefined();
  });

  it("rejects an unknown mode", () => {
    expect(() => loadConfig({ PROVIDER_MODE: "live" })).toThrow(/must be "stub" or "t212"/);
  });
});

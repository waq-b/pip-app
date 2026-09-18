import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { generateMasterKey } from "./crypto/secrets.js";

describe("server config", () => {
  it("defaults to stub mode, which needs no master key", () => {
    expect(loadConfig({})).toMatchObject({ providerMode: "stub", secretBox: undefined });
  });

  it("refuses to run against real providers without a master key", () => {
    expect(() => loadConfig({ PROVIDER_MODE: "t212" })).toThrow(/needs MASTER_KEY/);
  });

  it("runs against real providers with one", () => {
    const config = loadConfig({ PROVIDER_MODE: "t212", MASTER_KEY: generateMasterKey() });
    expect(config.providerMode).toBe("t212");
    expect(config.secretBox).toBeDefined();
  });

  it("refuses the live Trading 212 environment until Phase 8", () => {
    expect(() =>
      loadConfig({ PROVIDER_MODE: "t212", MASTER_KEY: generateMasterKey(), T212_ENV: "live" }),
    ).toThrow(/until Phase 8/);
  });

  it("refuses a short job secret", () => {
    expect(() => loadConfig({ JOB_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("rejects an unknown mode", () => {
    expect(() => loadConfig({ PROVIDER_MODE: "live" })).toThrow(/must be "stub" or "t212"/);
  });

  it("writes nudges with the stub unless told otherwise", () => {
    expect(loadConfig({}).llm).toEqual({ mode: "stub" });
  });

  it("uses Groq only with a key, defaulting to gpt-oss-120b", () => {
    expect(() => loadConfig({ LLM_MODE: "groq" })).toThrow(/GROQ_API_KEY/);
    expect(loadConfig({ LLM_MODE: "groq", GROQ_API_KEY: "gsk_x" }).llm).toEqual({
      mode: "groq",
      apiKey: "gsk_x",
      model: "openai/gpt-oss-120b",
    });
    expect(
      loadConfig({ LLM_MODE: "groq", GROQ_API_KEY: "gsk_x", LLM_MODEL: "openai/gpt-oss-20b" }).llm,
    ).toMatchObject({
      model: "openai/gpt-oss-20b",
    });
  });

  it("refuses an LLM mode it doesn't know — no Ollama (Waqar, 2026-09-17)", () => {
    expect(() => loadConfig({ LLM_MODE: "ollama" })).toThrow(/stub" or "groq/);
  });

  describe("live notifications", () => {
    const live = {
      NOTIFY_MODE: "live",
      VAPID_PUBLIC_KEY: "public",
      VAPID_PRIVATE_KEY: "private",
      RESEND_KEY: "re_key",
      EMAIL_FROM: "Pip <pip@mail.example.com>",
    };

    it.each(["mailto:test@example.com", "https://pip.example.com"])(
      "take a VAPID subject of %s",
      (subject) => {
        expect(loadConfig({ ...live, VAPID_SUBJECT: subject }).notify.mode).toBe("live");
      },
    );

    it("refuse any other subject", () => {
      expect(() => loadConfig({ ...live, VAPID_SUBJECT: "pip.example.com" })).toThrow(
        /mailto: address or an https:\/\/ URL/,
      );
    });

    it("refuse to start with a setting missing", () => {
      expect(() =>
        loadConfig({ ...live, VAPID_SUBJECT: "https://pip.example.com", RESEND_KEY: "" }),
      ).toThrow(/needs RESEND_KEY/);
    });
  });
});

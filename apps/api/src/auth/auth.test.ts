import { describe, expect, it } from "vitest";
import type { Adapter } from "@auth/core/adapters";
import { memoryAllowlistStore, normaliseEmail } from "./allowlist.js";
import { buildAuthConfig, NOT_ALLOWED_PATH, SESSION_IDLE_SECONDS } from "./config.js";
import { isLive, sessionCookieName } from "./session.js";

const adapter = {} as Adapter;

function configWith(allowed: string[]) {
  return buildAuthConfig({
    store: memoryAllowlistStore(allowed),
    adapter,
    secret: "test-secret",
    googleClientId: "id",
    googleClientSecret: "secret",
    useSecureCookies: false,
  });
}

/** Calls the signIn callback the way Auth.js does. */
function signIn(config: ReturnType<typeof configWith>, email: string, emailVerified = true) {
  return config.callbacks!.signIn!({
    user: { id: "user-1", email },
    profile: { email, email_verified: emailVerified },
  });
}

describe("normaliseEmail", () => {
  it("ignores case and surrounding space", () => {
    expect(normaliseEmail("  Someone@Example.COM ")).toBe("someone@example.com");
  });
});

describe("the allowlist gate", () => {
  it("lets an allowlisted address in", async () => {
    await expect(signIn(configWith(["test@example.com"]), "test@example.com")).resolves.toBe(
      true,
    );
  });

  it("matches regardless of case", async () => {
    await expect(signIn(configWith(["test@example.com"]), "Test@Example.com")).resolves.toBe(
      true,
    );
  });

  it("sends anyone else to the not-on-the-list screen", async () => {
    await expect(signIn(configWith(["test@example.com"]), "stranger@example.com")).resolves.toBe(
      NOT_ALLOWED_PATH,
    );
  });

  it("refuses an address Google has not verified, even if it is allowlisted", async () => {
    await expect(
      signIn(configWith(["test@example.com"]), "test@example.com", false),
    ).resolves.toBe(NOT_ALLOWED_PATH);
  });

  it("refuses when no email comes back at all", async () => {
    const config = configWith(["test@example.com"]);
    await expect(config.callbacks!.signIn!({ user: { id: "user-1", email: null } })).resolves.toBe(
      NOT_ALLOWED_PATH,
    );
  });

  it("closes the default: an empty allowlist admits nobody", async () => {
    await expect(signIn(configWith([]), "test@example.com")).resolves.toBe(NOT_ALLOWED_PATH);
  });
});

describe("session configuration", () => {
  it("stores sessions in the database, never in a token", () => {
    expect(configWith([]).session?.strategy).toBe("database");
  });

  it("expires 12 hours after you stop using it", () => {
    expect(configWith([]).session?.maxAge).toBe(SESSION_IDLE_SECONDS);
  });

  it("only marks the cookie Secure on https", () => {
    expect(sessionCookieName(false)).toBe("authjs.session-token");
    expect(sessionCookieName(true)).toBe("__Secure-authjs.session-token");
  });
});

describe("isLive", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  const hoursAgo = (n: number) => new Date(now.getTime() - n * 60 * 60 * 1000);
  const hoursAhead = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000);

  it("accepts a fresh session", () => {
    expect(isLive(hoursAhead(6), hoursAgo(1), now)).toBe(true);
  });

  it("rejects one that idled out", () => {
    expect(isLive(hoursAgo(1), hoursAgo(13), now)).toBe(false);
  });

  it("rejects one past the 7-day cap however active it has been", () => {
    expect(isLive(hoursAhead(6), hoursAgo(24 * 8), now)).toBe(false);
  });
});

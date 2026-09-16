import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { supabaseVerifier, type TokenVerifier } from "./jwt.js";

const ISSUER = "https://example-project.supabase.co/auth/v1";

let sign: (
  claims: Record<string, unknown>,
  options?: { issuer?: string; audience?: string; expiresIn?: string },
) => Promise<string>;
let signWithStranger: (claims: Record<string, unknown>) => Promise<string>;
let verifier: TokenVerifier;

/**
 * Real signatures, from a key generated for the test run. No Supabase project,
 * no network (CLAUDE.md hard line 7).
 */
beforeAll(async () => {
  const ours = await generateKeyPair("ES256");
  const stranger = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(ours.publicKey)), kid: "project-key", alg: "ES256" };

  verifier = supabaseVerifier({ issuer: ISSUER, keys: createLocalJWKSet({ keys: [jwk] }) });

  sign = (claims, options = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "project-key" })
      .setSubject("auth-user-1")
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? "authenticated")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "1h")
      .sign(ours.privateKey);

  signWithStranger = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: "project-key" })
      .setSubject("auth-user-1")
      .setIssuer(ISSUER)
      .setAudience("authenticated")
      .setExpirationTime("1h")
      .sign(stranger.privateKey);
});

describe("verifying a Supabase token", () => {
  it("accepts a token our project signed, and says who it is", async () => {
    const token = await sign({ email: "test@example.com", user_metadata: { full_name: "Waqar" } });

    await expect(verifier.verify(token)).resolves.toEqual({
      authUserId: "auth-user-1",
      email: "test@example.com",
      name: "Waqar",
    });
  });

  it("refuses a token signed by any other key", async () => {
    await expect(
      verifier.verify(await signWithStranger({ email: "test@example.com" })),
    ).resolves.toBeNull();
  });

  it("refuses a token from another Supabase project", async () => {
    const token = await sign(
      { email: "test@example.com" },
      { issuer: "https://someone-else.supabase.co/auth/v1" },
    );
    await expect(verifier.verify(token)).resolves.toBeNull();
  });

  it("refuses a token not meant for a signed-in user", async () => {
    await expect(
      verifier.verify(await sign({ email: "test@example.com" }, { audience: "anon" })),
    ).resolves.toBeNull();
  });

  it("refuses an expired token", async () => {
    await expect(
      verifier.verify(await sign({ email: "test@example.com" }, { expiresIn: "-1m" })),
    ).resolves.toBeNull();
  });

  it("refuses a token with no email, since the allowlist is keyed on it", async () => {
    await expect(verifier.verify(await sign({}))).resolves.toBeNull();
  });

  it("refuses junk without throwing", async () => {
    for (const junk of ["", "not.a.jwt", "a.b.c"]) {
      await expect(verifier.verify(junk)).resolves.toBeNull();
    }
  });
});

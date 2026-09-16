import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** Who a verified Supabase token says the caller is. Nothing here says they may come in. */
export interface VerifiedUser {
  /** `sub` — the id of the row in Supabase's `auth.users`. */
  authUserId: string;
  email: string;
  name?: string;
}

export interface TokenVerifier {
  /** Null for anything that isn't a valid, current token from our project. */
  verify(token: string): Promise<VerifiedUser | null>;
}

/**
 * Verifies a Supabase access token against the project's published signing
 * keys (CLAUDE.md s3: the API verifies the JWT on every route). Issuer and
 * audience are both checked, so a token from another Supabase project — or
 * one meant for something other than a signed-in user — is refused.
 */
export function supabaseVerifier(options: {
  issuer: string;
  keys: JWTVerifyGetKey;
}): TokenVerifier {
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, options.keys, {
          issuer: options.issuer,
          audience: "authenticated",
          // Asymmetric only: a token can't pick an algorithm we didn't intend.
          algorithms: ["ES256", "RS256"],
        });

        const email = typeof payload.email === "string" ? payload.email : undefined;
        if (!payload.sub || !email) return null;

        const metadata = payload.user_metadata as
          { full_name?: unknown; name?: unknown } | undefined;
        const name =
          typeof metadata?.full_name === "string"
            ? metadata.full_name
            : typeof metadata?.name === "string"
              ? metadata.name
              : undefined;

        return { authUserId: payload.sub, email, name };
      } catch {
        return null;
      }
    },
  };
}

/** The real verifier, reading the project URL from the environment. */
export function supabaseVerifierFromEnv(): TokenVerifier {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_URL is not set — the API cannot verify anyone without it");
  }

  const base = url.replace(/\/$/, "");
  return supabaseVerifier({
    issuer: `${base}/auth/v1`,
    keys: createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`)),
  });
}

/**
 * What `buildApp` uses when given no verifier: nobody gets in. Failing closed
 * means a misconfigured server refuses everyone rather than admitting everyone.
 */
export const refuseEveryone: TokenVerifier = {
  verify: async () => null,
};

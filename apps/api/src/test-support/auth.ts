import type { BuildAppOptions } from "../app.js";
import { memoryAllowlistStore } from "../auth/allowlist.js";
import type { TokenVerifier, VerifiedUser } from "../auth/jwt.js";
import { memoryWaitlistStore } from "../auth/waitlist.js";

/**
 * Auth for route tests: a verifier that recognises tokens this helper hands
 * out, and in-memory allowlist and waitlist stores. Real signature
 * verification is tested on its own in `auth/jwt.test.ts`.
 */
export function testAuth(allowed: string[] = ["test@example.com"]) {
  const tokens = new Map<string, VerifiedUser>();
  const verifier: TokenVerifier = { verify: async (token) => tokens.get(token) ?? null };
  const allowlistStore = memoryAllowlistStore(allowed);
  const waitlistStore = memoryWaitlistStore();

  const options: BuildAppOptions = { verifier, allowlistStore, waitlistStore };

  return {
    options,
    allowlistStore,
    waitlistStore,
    /** Headers carrying a token that verifies as this person. */
    headersFor(email: string, name?: string) {
      const token = `test-token-for-${email}`;
      tokens.set(token, { authUserId: `auth-${email}`, email, name });
      return { authorization: `Bearer ${token}` };
    },
  };
}

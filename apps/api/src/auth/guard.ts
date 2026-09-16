import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AllowedUser, AllowlistStore } from "./allowlist.js";
import type { TokenVerifier, VerifiedUser } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set once the bearer token verifies. */
    authUser?: VerifiedUser;
    /** Set once that person is also found on the allowlist. */
    allowedUser?: AllowedUser;
  }
}

/** The only route that answers without a token (CLAUDE.md hard line 4). */
export const PUBLIC_PATHS = ["/health"];

/**
 * Routes that need a valid token but not the allowlist: someone who has just
 * been refused still has to be able to learn that, and to ask to be let in.
 */
export const SIGNED_IN_ONLY_PATHS = ["/me", "/waitlist"];

/**
 * Machine callers: the scheduler, not a person. Authenticated by a shared job
 * secret in `x-job-secret` instead of a user token — still authenticated, so
 * hard line 4 holds. Without a configured secret these refuse everyone.
 */
export const JOB_PATHS = ["/jobs/refresh"];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.includes(path);
}

export interface AuthGuardOptions {
  verifier: TokenVerifier;
  allowlist: AllowlistStore;
  /** From `JOB_SECRET`. Absent means job routes refuse every caller. */
  jobSecret?: string;
}

/**
 * Two walls, in order: a valid Supabase token (401 without one), then a row on
 * the allowlist (403 `not_on_the_list` without one).
 *
 * Registered directly on the root instance rather than through `register`, so
 * the hook isn't encapsulated into a child scope and genuinely covers every
 * route, including ones added later. A route is protected by existing.
 */
export function registerAuthGuard(app: FastifyInstance, options: AuthGuardOptions): void {
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (isPublicPath(path)) return;
    if (JOB_PATHS.includes(path)) {
      return jobSecretMatches(options.jobSecret, request.headers["x-job-secret"])
        ? undefined
        : refuse(reply, 401, "unauthenticated");
    }

    const token = bearerToken(request.headers.authorization);
    if (!token) return refuse(reply, 401, "unauthenticated");

    const user = await options.verifier.verify(token);
    if (!user) return refuse(reply, 401, "unauthenticated");
    request.authUser = user;

    if (SIGNED_IN_ONLY_PATHS.includes(path)) return;

    let allowed = await options.allowlist.find(user.email);
    if (!allowed) return refuse(reply, 403, "not_on_the_list");

    // Row Level Security finds a user's rows through this link, so make sure
    // it exists before any route reads as them — not only when /me is called.
    if (allowed.authUserId === null) {
      await options.allowlist.linkAuthUser(allowed.id, user.authUserId);
      allowed = { ...allowed, authUserId: user.authUserId };
    }
    request.allowedUser = allowed;
  });
}

/** Constant-time comparison of hashes, so neither timing nor length leaks the secret. */
export function jobSecretMatches(
  expected: string | undefined,
  given: string | string[] | undefined,
): boolean {
  if (!expected || typeof given !== "string" || !given) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(given));
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match?.[1];
}

function refuse(reply: FastifyReply, status: 401 | 403, error: string) {
  return reply.status(status).send({ error });
}

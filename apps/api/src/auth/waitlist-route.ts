import type { FastifyInstance } from "fastify";
import { verifyWaitlistToken } from "./waitlist-token.js";
import type { WaitlistStore } from "./waitlist.js";

export const WAITLIST_PATH = "/waitlist";

export interface WaitlistRouteOptions {
  store: WaitlistStore;
  secret: string;
}

/**
 * The one route that answers without a session. It is not open: the token it
 * requires can only have come from a sign-in Google verified minutes earlier,
 * and the email is taken from inside that token, never from the request body.
 */
export function registerWaitlistRoute(app: FastifyInstance, options: WaitlistRouteOptions): void {
  app.post<{ Body?: { token?: string } }>(WAITLIST_PATH, async (request, reply) => {
    const token = request.body?.token;
    if (!token) {
      return reply.status(401).send({ error: "missing_token" });
    }

    const claim = verifyWaitlistToken(token, options.secret);
    if (!claim) {
      // Expired, tampered with, or signed by something that isn't us.
      return reply.status(401).send({ error: "invalid_token" });
    }

    await options.store.add(claim.email, claim.name);

    // Deliberately says nothing about queue position or timing — there is no
    // email system, and Waqar grants access by hand.
    return reply.status(200).send({ status: "added", email: claim.email });
  });
}

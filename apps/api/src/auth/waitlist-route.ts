import type { FastifyInstance } from "fastify";
import type { WaitlistStore } from "./waitlist.js";

export const WAITLIST_PATH = "/waitlist";

/**
 * Asking to be let in. The caller must hold a valid Supabase token, and the
 * address comes from that token — never from the request body — so nobody can
 * put someone else's email on the list.
 */
export function registerWaitlistRoute(
  app: FastifyInstance,
  options: { store: WaitlistStore },
): void {
  app.post(WAITLIST_PATH, async (request, reply) => {
    const user = request.authUser!;
    await options.store.add(user.email, user.name);

    // No queue position and no promise of an email: Waqar lets people in by hand.
    return reply.status(200).send({ status: "added", email: user.email });
  });
}

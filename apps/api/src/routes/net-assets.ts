import type { FastifyInstance, FastifyRequest } from "fastify";
import { dueReview, parseNetAssets, type NetAssetsStore } from "../rules/net-assets.js";
import { limitFor } from "../rules/side-bet.js";

/**
 * Net assets (phase-6.md decision 13). The figure is sealed and the routes are
 * built so it isn't handed out by accident: the ordinary read says only whether
 * it's set and when it was reviewed, and the figure — with the limit, which
 * gives it away ten times over — comes back only from an explicit reveal.
 *
 * Pip uses it for one thing: Side Bet's limit. It never leaves the API for
 * anywhere else, and it is never logged (`logging.ts` redacts these bodies).
 */
export function registerNetAssetsRoutes(
  app: FastifyInstance,
  options: { store: NetAssetsStore; now?: () => Date },
): void {
  const now = options.now ?? (() => new Date());
  const userOf = (request: FastifyRequest) => ({
    userId: request.allowedUser!.id,
    authUserId: request.authUser!.authUserId,
  });

  /** Status only: set or not, when it was reviewed, whether a year has passed. */
  app.get("/net-assets", async (request) => {
    const stored = await options.store.read(userOf(request));
    const { starter } = limitFor(stored.pence);
    return {
      set: stored.pence !== null,
      starterLimit: starter,
      ...(stored.reviewedAt ? { reviewedAt: stored.reviewedAt.toISOString() } : {}),
      dueReview: dueReview(stored.reviewedAt, now()),
    };
  });

  app.put("/net-assets", async (request, reply) => {
    const parsed = parseNetAssets(request.body);
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
    const saved = await options.store.set(userOf(request), parsed.pence, now());
    const { limitPence, starter } = limitFor(saved.pence);
    // Straight back, because the person just typed it: the screen shows the
    // limit it bought them before hiding both again.
    return {
      set: true,
      starterLimit: starter,
      pounds: Math.round(saved.pence! / 100),
      limit: limitPence,
      reviewedAt: saved.reviewedAt!.toISOString(),
      dueReview: false,
    };
  });

  /** The eye: the figure and the limit, only when asked for outright. */
  app.post("/net-assets/reveal", async (request) => {
    const stored = await options.store.read(userOf(request));
    const { limitPence, starter } = limitFor(stored.pence);
    return {
      set: stored.pence !== null,
      starterLimit: starter,
      ...(stored.pence === null ? {} : { pounds: Math.round(stored.pence / 100) }),
      limit: limitPence,
    };
  });
}

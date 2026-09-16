import type { RuleSettings } from "@finance-app/shared";
import type { FastifyInstance } from "fastify";
import { parseRuleSettings } from "../rules/settings.js";
import type { RulesStore } from "../rules/store.js";

/**
 * Changing the shape (Phase 4). Behind the auth guard like every route; the
 * limits are checked here, on the server, whatever the screen allowed. A rule
 * only changes what Pip tells you — nothing here can move money.
 */
export interface SavedRules {
  settings: RuleSettings;
  /** ISO timestamp. */
  lastChangedAt: string;
}

export function registerRulesRoutes(
  app: FastifyInstance,
  options: { store: RulesStore; now?: () => Date },
): void {
  const now = options.now ?? (() => new Date());

  app.put("/rules", async (request, reply) => {
    const parsed = parseRuleSettings(request.body);
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
    const user = { userId: request.allowedUser!.id, authUserId: request.authUser!.authUserId };
    const stored = await options.store.set(user, parsed.settings, now());
    const saved: SavedRules = {
      settings: stored.settings,
      lastChangedAt: (stored.updatedAt ?? now()).toISOString(),
    };
    return saved;
  });
}

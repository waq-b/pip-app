import type { MeResponse } from "@finance-app/shared";
import type { FastifyInstance } from "fastify";
import type { AllowlistStore } from "./allowlist.js";

/**
 * Tells a signed-in person whether they're allowed in. Reachable without being
 * on the allowlist — that's the point of it. The first time an allowlisted
 * person arrives, their row is linked to their Supabase identity.
 */
export function registerMeRoute(
  app: FastifyInstance,
  options: { allowlist: AllowlistStore },
): void {
  app.get("/me", async (request) => {
    const user = request.authUser!;
    const allowed = await options.allowlist.find(user.email);

    if (allowed && allowed.authUserId === null) {
      await options.allowlist.linkAuthUser(allowed.id, user.authUserId);
    }

    const response: MeResponse = { email: user.email, name: user.name, allowed: Boolean(allowed) };
    return response;
  });
}

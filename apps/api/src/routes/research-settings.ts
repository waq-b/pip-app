import type { ProfileView, TrustRulesView } from "@finance-app/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parseProfile, type ProfileStore, type StoredProfile } from "../nudges/profile.js";
import {
  parseTrustSettings,
  type StoredTrustSettings,
  type TrustSettingsStore,
} from "../rules/trust-settings.js";

/**
 * Phase 5 settings: the profile Pip writes for, and the trust rules that
 * decide what it may show. Behind the auth guard like every route; limits are
 * checked here whatever the screen allowed. Neither can move money, and
 * neither changes the shape rules (design rules 1, 2).
 */
export function registerResearchSettingsRoutes(
  app: FastifyInstance,
  options: { profiles: ProfileStore; trust: TrustSettingsStore; now?: () => Date },
): void {
  const now = options.now ?? (() => new Date());
  const userOf = (request: FastifyRequest) => ({
    userId: request.allowedUser!.id,
    authUserId: request.authUser!.authUserId,
  });

  const profileView = (request: FastifyRequest, stored: StoredProfile): ProfileView => ({
    profile: stored.profile,
    personalised: request.allowedUser!.personalResearch,
    ...(stored.updatedAt ? { lastChangedAt: stored.updatedAt.toISOString() } : {}),
  });
  const trustView = (stored: StoredTrustSettings): TrustRulesView => ({
    settings: stored.settings,
    ...(stored.updatedAt ? { lastChangedAt: stored.updatedAt.toISOString() } : {}),
  });

  app.get("/profile", async (request) =>
    profileView(request, await options.profiles.get(userOf(request))),
  );

  app.put("/profile", async (request, reply) => {
    const parsed = parseProfile(request.body);
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
    return profileView(request, await options.profiles.set(userOf(request), parsed.profile, now()));
  });

  app.get("/trust-rules", async (request) => trustView(await options.trust.get(userOf(request))));

  app.put("/trust-rules", async (request, reply) => {
    const parsed = parseTrustSettings(request.body);
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
    return trustView(await options.trust.set(userOf(request), parsed.settings, now()));
  });
}

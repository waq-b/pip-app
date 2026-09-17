import { NUDGE_RESPONSES, type NudgeResponse, type NudgeResponseResult } from "@finance-app/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { NudgeService, NudgeUser } from "../nudges/service.js";

/**
 * Your week (Phase 5 task 7). Behind the auth guard like every route. Reading
 * applies today's trust rules to what was built; marking what you did is the
 * only write, and only ever to your own nudge.
 */
export function registerWeekRoutes(app: FastifyInstance, options: { service: NudgeService }): void {
  const userOf = (request: FastifyRequest): NudgeUser => ({
    userId: request.allowedUser!.id,
    authUserId: request.authUser!.authUserId,
    personalResearch: request.allowedUser!.personalResearch,
  });

  app.get("/week", async (request) => options.service.thisWeek(userOf(request)));

  app.get<{ Params: { weekOf: string } }>("/week/:weekOf", async (request, reply) => {
    const { weekOf } = request.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf) || Number.isNaN(Date.parse(weekOf))) {
      return reply.status(400).send({ error: "invalid_week" });
    }
    const week = await options.service.week(userOf(request), weekOf);
    return week ?? reply.status(404).send({ error: "no_such_week" });
  });

  app.post<{ Params: { id: string } }>("/nudges/:id/response", async (request, reply) => {
    const response = (request.body as { response?: unknown } | undefined)?.response;
    if (!NUDGE_RESPONSES.includes(response as NudgeResponse)) {
      return reply.status(400).send({ error: "invalid_response" });
    }
    const saved = await options.service.respond(
      userOf(request),
      request.params.id,
      response as NudgeResponse,
    );
    if (!saved) return reply.status(404).send({ error: "no_such_nudge" });
    const result: NudgeResponseResult = {
      id: saved.id,
      response: saved.response!,
      respondedAt: saved.respondedAt!.toISOString(),
    };
    return result;
  });
}

import type { FastifyInstance } from "fastify";

/**
 * `POST /jobs/refresh` — the scheduler's door. The guard has already checked
 * the job secret. Answers 202 straight away and works afterwards: a sleeping
 * Render instance can take about a minute to wake, and `pg_net` shouldn't have
 * to wait for the work too. Without a job runner (stub mode) there's nothing
 * to do.
 */
export function registerJobRoutes(
  app: FastifyInstance,
  options: { refresh?: { run(): Promise<unknown> } },
): void {
  app.post("/jobs/refresh", async (request, reply) => {
    if (!options.refresh) return reply.status(202).send({ status: "nothing_to_do" });
    options.refresh.run().catch((error: unknown) => {
      request.log.error({ err: error }, "refresh job failed");
    });
    return reply.status(202).send({ status: "started" });
  });
}

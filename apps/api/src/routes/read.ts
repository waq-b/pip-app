import { BUCKETS, type Bucket, type PriceRange, type Timeframe } from "@finance-app/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ReadModel, ReadUser } from "../read/model.js";

const TIMEFRAMES: Timeframe[] = ["day", "month", "all"];
const RANGES: PriceRange[] = ["day", "month", "year", "all"];

/**
 * Everything the screens read. The routes validate input and hand over to the
 * read model — stub sample data or real accounts (`read/`). Each response is
 * composed from two sources that are never mixed: what is held, and what it
 * is worth (CLAUDE.md s4).
 *
 * All of these sit behind the auth guard — registered after it, and the
 * route-coverage test proves it.
 */
export function registerReadRoutes(app: FastifyInstance, options: { model: ReadModel }): void {
  const { model } = options;

  app.get<{ Querystring: { tf?: string } }>("/portfolio", async (request, reply) => {
    const timeframe = parseTimeframe(request.query.tf);
    if (!timeframe) return reply.status(400).send({ error: "unknown_timeframe" });
    return model.portfolio(userOf(request), timeframe);
  });

  app.get<{ Params: { id: string }; Querystring: { tf?: string } }>(
    "/buckets/:id",
    async (request, reply) => {
      const bucket = parseBucket(request.params.id);
      if (!bucket) return reply.status(404).send({ error: "unknown_bucket" });
      const timeframe = parseTimeframe(request.query.tf);
      if (!timeframe) return reply.status(400).send({ error: "unknown_timeframe" });
      return model.bucket(userOf(request), bucket, timeframe);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    "/instruments/:id",
    async (request, reply) => {
      const range = parseRange(request.query.range);
      if (!range) return reply.status(400).send({ error: "unknown_range" });
      const detail = await model.instrument(userOf(request), request.params.id, range);
      if (!detail) return reply.status(404).send({ error: "unknown_instrument" });
      return detail;
    },
  );

  app.get("/rules", async (request) => model.rules(userOf(request)));
  app.get("/activity", async (request) => model.activity(userOf(request)));
}

function userOf(request: FastifyRequest): ReadUser {
  return { userId: request.allowedUser!.id, authUserId: request.authUser!.authUserId };
}

function parseTimeframe(value: string | undefined): Timeframe | undefined {
  if (value === undefined) return "day";
  return TIMEFRAMES.find((timeframe) => timeframe === value);
}

function parseRange(value: string | undefined): PriceRange | undefined {
  if (value === undefined) return "all";
  return RANGES.find((range) => range === value);
}

function parseBucket(value: string): Bucket | undefined {
  return BUCKETS.find((bucket) => bucket === value);
}

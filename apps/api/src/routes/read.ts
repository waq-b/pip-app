import {
  BUCKETS,
  BUCKET_META,
  type Bucket,
  type BucketDetail,
  type BucketSummary,
  type Holding,
  type InstrumentDetail,
  type PortfolioSummary,
  type PriceRange,
  type RulesView,
  type Timeframe,
} from "@finance-app/shared";
import type { FastifyInstance } from "fastify";
import {
  ACTIVITY,
  BUCKET_FIXTURES,
  CONNECTIONS,
  DEGEN_OVER_BY,
  INSTRUMENT_FIXTURES,
  MONTHLY_SPLIT,
  TOTAL_CHANGE,
  TOTAL_VALUE,
  verdictFor,
} from "../fixtures/portfolio.js";
import type { MarketData } from "../market/market.js";
import { allStubPositions, StubProvider } from "../providers/stub/index.js";

const TIMEFRAMES: Timeframe[] = ["day", "month", "all"];
const RANGES: PriceRange[] = ["day", "month", "year", "all"];

export interface ReadRoutesOptions {
  market: MarketData;
}

/**
 * Everything the screens read. Each response is composed from two sources that
 * are never mixed: the trading layer says what is held, the market layer says
 * what it is worth and what it has done (CLAUDE.md s4).
 *
 * All of these sit behind the session guard — they are registered after it, and
 * the route-coverage test proves it.
 */
export function registerReadRoutes(app: FastifyInstance, options: ReadRoutesOptions): void {
  const { market } = options;

  app.get<{ Querystring: { tf?: string } }>("/portfolio", async (request, reply) => {
    const timeframe = parseTimeframe(request.query.tf);
    if (!timeframe) return reply.status(400).send({ error: "unknown_timeframe" });

    const buckets: BucketSummary[] = [];
    for (const bucket of BUCKETS) {
      const fixture = BUCKET_FIXTURES[bucket];
      buckets.push({
        bucket,
        value: fixture.value,
        change: fixture.change[timeframe],
        blurb: fixture.blurb,
        shareOfTotal: fixture.shareOfTotal,
        targetPercent: fixture.targetPercent,
        series: await market.getSeries(seriesIdFor(bucket), "month"),
      });
    }

    const freshness = [];
    for (const bucket of BUCKETS) {
      freshness.push({ bucket, freshness: await market.getFreshness(bucket) });
    }

    const summary: PortfolioSummary = {
      timeframe,
      total: TOTAL_VALUE,
      change: TOTAL_CHANGE[timeframe],
      verdict: verdictFor(timeframe, isOverCap()),
      buckets,
      freshness,
    };

    return summary;
  });

  app.get<{ Params: { id: string }; Querystring: { tf?: string } }>(
    "/buckets/:id",
    async (request, reply) => {
      const bucket = parseBucket(request.params.id);
      if (!bucket) return reply.status(404).send({ error: "unknown_bucket" });

      const timeframe = parseTimeframe(request.query.tf);
      if (!timeframe) return reply.status(400).send({ error: "unknown_timeframe" });

      const fixture = BUCKET_FIXTURES[bucket];
      const provider = new StubProvider(bucket);
      const positions = await provider.getPositions();
      const history = await provider.getHistory();

      const holdings: Holding[] = [];
      for (const position of positions) {
        const instrument = INSTRUMENT_FIXTURES[position.id];
        holdings.push({
          id: position.id,
          name: position.name,
          subtitle: position.subtitle,
          bucket,
          value: position.value,
          today: instrument?.today ?? flat(),
          sinceBought: instrument?.sinceBought ?? flat(),
          shareOfBucket: instrument?.shareOfBucket ?? 0,
          series: await market.getSeries(position.id, "month"),
        });
      }

      const detail: BucketDetail = {
        bucket,
        value: fixture.value,
        change: fixture.change[timeframe],
        blurb: fixture.blurb,
        plain: fixture.plain,
        chart: {
          from: fixture.chartFrom,
          series: await market.getSeries(seriesIdFor(bucket), "all"),
          caption: fixture.chartCaption,
        },
        moneyIn: {
          months: history.map((entry) => ({
            label: monthLabel(entry.date),
            amount: entry.amount,
          })),
          caption: fixture.moneyInCaption,
        },
        holdings,
        freshness: await market.getFreshness(bucket),
      };

      return detail;
    },
  );

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    "/instruments/:id",
    async (request, reply) => {
      const found = allStubPositions().find(({ position }) => position.id === request.params.id);
      if (!found) return reply.status(404).send({ error: "unknown_instrument" });

      const range = parseRange(request.query.range);
      if (!range) return reply.status(400).send({ error: "unknown_range" });

      const { bucket, position } = found;
      const instrument = INSTRUMENT_FIXTURES[position.id];

      const detail: InstrumentDetail = {
        id: position.id,
        name: position.name,
        ticker: position.ticker,
        bucket,
        quantity: instrument?.quantity ?? `${position.quantity}`,
        price: await market.getPrice(position.id),
        value: position.value,
        today: instrument?.today ?? flat(),
        sinceBought: instrument?.sinceBought ?? flat(),
        note: instrument?.note ?? "",
        range,
        series: await market.getSeries(position.id, range),
        freshness: await market.getFreshness(bucket),
      };

      return detail;
    },
  );

  app.get("/rules", async () => {
    const view: RulesView = {
      rules: BUCKETS.map((bucket) => {
        const fixture = BUCKET_FIXTURES[bucket];
        const over = bucket === "Degen" && isOverCap();

        return {
          bucket,
          kind: fixture.isCap ? ("cap" as const) : ("target" as const),
          targetPercent: fixture.targetPercent,
          actualPercent: fixture.shareOfTotal,
          plain: fixture.rulePlain,
          ...(over ? { overBy: DEGEN_OVER_BY } : {}),
        };
      }),
      monthlySplit: MONTHLY_SPLIT,
    };

    return view;
  });

  app.get("/activity", async () => ACTIVITY);

  app.get("/connections", async () => CONNECTIONS);
}

/** Side Bet is the only pot with a hard cap, and the only one that can go over. */
function isOverCap(): boolean {
  const degen = BUCKET_FIXTURES.Degen;
  return degen.shareOfTotal > degen.targetPercent;
}

/**
 * A pot's own value series is seeded separately from any holding's, so the
 * three pots don't draw the same line.
 */
function seriesIdFor(bucket: Bucket): string {
  return `bucket:${BUCKET_META[bucket].scope}`;
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

function flat() {
  return { amount: 0, percent: 0, direction: "flat" as const };
}

/**
 * Fixed names rather than `toLocaleString`: ICU versions disagree on September
 * ("Sep" vs "Sept"), so the label could change between machines. The design
 * uses three letters.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(isoDate: string): string {
  return MONTHS[new Date(isoDate).getUTCMonth()]!;
}

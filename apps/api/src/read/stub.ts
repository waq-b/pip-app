import {
  BUCKETS,
  BUCKET_META,
  type ActivityEntry,
  type Bucket,
  type BucketDetail,
  type BucketSummary,
  type Holding,
  type InstrumentDetail,
  type PortfolioSummary,
} from "@finance-app/shared";
import {
  ACTIVITY,
  BUCKET_FIXTURES,
  INSTRUMENT_FIXTURES,
  MONTHLY_SPLIT,
  TOTAL_CHANGE,
  TOTAL_VALUE,
  verdictFor,
} from "../fixtures/portfolio.js";
import type { MarketData } from "../market/market.js";
import { allStubPositions, StubProvider } from "../providers/stub/index.js";
import { evaluateRules } from "../rules/engine.js";
import { memoryRulesStore, type RulesStore } from "../rules/store.js";
import { ruleFlagFor, rulesView } from "../rules/view.js";
import type { ReadModel, ReadUser } from "./model.js";

/**
 * Stub mode: the design's sample data, composed from the stub trading provider
 * (what is held) and the stub market layer (what it's worth). Rules are the
 * user's own (kept in memory) judged by the real engine against the sample
 * values, so changing a rule in stub mode changes what the screens say.
 */
export function stubReadModel(
  market: MarketData,
  rulesStore: RulesStore = memoryRulesStore(),
): ReadModel {
  async function judge(user: ReadUser) {
    const stored = await rulesStore.get(user);
    const evaluation = evaluateRules(
      BUCKETS.map((bucket) => ({
        bucket,
        connected: true,
        valuePence: BUCKET_FIXTURES[bucket].value,
      })),
      stored.settings,
    );
    return { stored, evaluation };
  }

  return {
    async portfolio(user, timeframe) {
      const { evaluation } = await judge(user);
      const buckets: BucketSummary[] = [];
      for (const bucket of BUCKETS) {
        const fixture = BUCKET_FIXTURES[bucket];
        buckets.push({
          bucket,
          value: fixture.value,
          change: fixture.change[timeframe],
          blurb: fixture.blurb,
          shareOfTotal: fixture.shareOfTotal,
          targetPercent: evaluation.pots.find((p) => p.bucket === bucket)!.linePercent,
          ...ruleFlagFor(evaluation, bucket),
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
        verdict: verdictFor(timeframe, evaluation.needsAttention),
        rulesNeedAttention: evaluation.needsAttention,
        buckets,
        freshness,
      };
      return summary;
    },

    async bucket(user, bucket, timeframe) {
      const fixture = BUCKET_FIXTURES[bucket];
      const { evaluation } = await judge(user);
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
        ...ruleFlagFor(evaluation, bucket),
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
          months: history.map((entry) => ({ label: monthLabel(entry.date), amount: entry.amount })),
          caption: fixture.moneyInCaption,
        },
        holdings,
        freshness: await market.getFreshness(bucket),
      };
      return detail;
    },

    async instrument(_user, id, range) {
      const found = allStubPositions().find(({ position }) => position.id === id);
      if (!found) return null;
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

    async rules(user) {
      const { stored, evaluation } = await judge(user);
      return rulesView(evaluation, stored, MONTHLY_SPLIT, () => "");
    },

    async activity(): Promise<ActivityEntry[]> {
      return ACTIVITY;
    },
  };
}

/**
 * A pot's own value series is seeded separately from any holding's, so the
 * three pots don't draw the same line.
 */
function seriesIdFor(bucket: Bucket): string {
  return `bucket:${BUCKET_META[bucket].scope}`;
}

function flat() {
  return { amount: 0, percent: 0, direction: "flat" as const };
}

/**
 * Fixed names rather than `toLocaleString`: ICU versions disagree on September
 * ("Sep" vs "Sept"), so the label could change between machines.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(isoDate: string): string {
  return MONTHS[new Date(isoDate).getUTCMonth()]!;
}

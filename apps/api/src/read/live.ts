import {
  BUCKETS,
  displayNameFor,
  type Bucket,
  type BucketDetail,
  type BucketFreshness,
  type BucketRule,
  type BucketStatus,
  type BucketSummary,
  type Change,
  type Holding,
  type InstrumentDetail,
  type PortfolioSummary,
  type PriceFreshness,
  type PriceRange,
  type SeriesPoint,
  type Timeframe,
} from "@finance-app/shared";
import { and, asc, eq, gte, inArray, min } from "drizzle-orm";
import {
  cash,
  dailyCloses,
  dailyValues,
  holdings,
  instruments,
  intradaySeries,
  marketSchedules,
  prices,
  providerCredentials,
  trades,
} from "../db/schema.js";
import { asUser, type Db, type UserTx } from "../db/user-scope.js";
import { isMarketOpen, scheduleCovers, type ScheduleEvent } from "../market/hours.js";
import {
  ensureDailyCloses,
  fxKey,
  fxQuoteFor,
  refreshDue,
  targetFor,
  type PricedInstrument,
} from "../market/refresh.js";
import type { withFallback } from "../market/sources/fallback.js";
import { londonDay } from "../sync/poll.js";
import { bucketForAccountKind, poundsPerUnit } from "../valuation/value.js";
import type { ReadModel, ReadUser } from "./model.js";

/**
 * Real accounts (Trading 212 mode): what the signed-in user holds, valued with
 * market prices — never a trading API's (hard line 8) — in pence of pounds.
 *
 * Reads run as the user, so Row Level Security decides what's visible. Before
 * reading, prices that are due get refreshed (shared, privileged), but a slow
 * source never holds a screen up for more than a few seconds: the refresh
 * carries on in the background and the staleness ladder tells the truth.
 *
 * What isn't built from real data yet says so rather than showing samples:
 * Side Bet (Kraken, Phase 3), "What changed" and "Money in" (decision 4), the
 * plain-English notes (Phase 5).
 */

type Market = ReturnType<typeof withFallback>;

export interface LiveReadOptions {
  db: Db;
  marketFor: (instrument: PricedInstrument | null) => Market;
  now?: () => Date;
  /** How long a read waits for due prices before answering with what's cached. */
  refreshWaitMs?: number;
}

const TARGETS: Record<Bucket, number> = { Base: 70, Medium: 25, Degen: 5 };

const COPY: Record<Bucket, { blurb: string; plain: string }> = {
  Base: {
    blurb: "Your Stocks & Shares ISA",
    plain: "The long-term money. Pip reads it from your Trading 212 ISA and never touches it.",
  },
  Medium: {
    blurb: "Your Invest account",
    plain:
      "The companies and funds you picked yourself, read from your Trading 212 Invest account.",
  },
  Degen: {
    blurb: "Your Kraken account",
    plain:
      "The small, capped pot for crypto, read from your Kraken account with a key that can't trade or withdraw.",
  },
};

interface HeldInstrument {
  instrumentId: string;
  name: string;
  shortName: string;
  type: string;
  currency: string;
  workingScheduleId: number | null;
  quantity: number;
  /** Staked or earning part of `quantity` (Kraken). */
  stakedQuantity: number | null;
  /** Null until known (Kraken, before its history is rebuilt). */
  totalCostPence: number | null;
  price?: typeof prices.$inferSelect;
  /** Pence of pounds per unit now, and at the previous close. */
  unitPence?: number;
  previousUnitPence?: number;
  /**
   * What "today" is measured from. Normally yesterday's close; for something
   * first bought today, what was paid — the rise before buying wasn't yours.
   */
  previousValuePence?: number;
}

interface Pot {
  bucket: Bucket;
  status: BucketStatus;
  held: HeldInstrument[];
  cashPence: number;
  investedPence: number;
  costPence: number;
  /** Every holding's cost is known, so "all time" can be stated. */
  costKnown: boolean;
  todayPence: number;
  previousInvestedPence: number;
  /** Every holding has a price. */
  priced: boolean;
}

interface Snapshot {
  pots: Record<Bucket, Pot>;
  schedules: Map<number, ScheduleEvent[]>;
  values: (typeof dailyValues.$inferSelect)[];
}

export function liveReadModel(options: LiveReadOptions): ReadModel {
  const now = options.now ?? (() => new Date());
  const waitMs = options.refreshWaitMs ?? 2_000;

  async function refreshFirst(user: ReadUser) {
    const held = await asUser(options.db, user.authUserId, (tx) =>
      tx.selectDistinct({ id: holdings.instrumentId }).from(holdings),
    );
    if (held.length === 0) return;
    const refresh = refreshDue(
      options.db,
      options.marketFor,
      held.map((row) => row.id),
      now(),
    ).catch(() => undefined);
    await Promise.race([refresh, new Promise((resolve) => setTimeout(resolve, waitMs))]);
  }

  async function load(user: ReadUser): Promise<Snapshot> {
    return asUser(options.db, user.authUserId, (tx) => loadAsUser(tx, now()));
  }

  return {
    async portfolio(user, timeframe) {
      await refreshFirst(user);
      const snapshot = await load(user);
      const at = now();
      const live = BUCKETS.map((bucket) => snapshot.pots[bucket]).filter(
        (pot) => pot.status !== "not_connected",
      );
      const total = live.reduce((sum, pot) => sum + pot.investedPence + pot.cashPence, 0);

      const potChanges = new Map(
        live.map((pot) => [pot.bucket, changeFor(pot, timeframe, snapshot.values, at)]),
      );
      const changeUnavailable = [...potChanges.values()].some((change) => change === null);
      const change = changeUnavailable
        ? flat()
        : combine([...potChanges.values()] as { amount: number; base: number }[]);

      const buckets: BucketSummary[] = BUCKETS.map((bucket) => {
        const pot = snapshot.pots[bucket];
        const value = pot.investedPence + pot.cashPence;
        const potChange = potChanges.get(bucket);
        return {
          bucket,
          status: pot.status,
          value,
          change: potChange ? toChange(potChange.amount, potChange.base) : flat(),
          changeUnavailable: pot.status !== "not_connected" && potChange === null,
          blurb: COPY[bucket].blurb,
          shareOfTotal:
            pot.status === "not_connected" || total === 0 ? 0 : round2((value / total) * 100),
          targetPercent: TARGETS[bucket],
          series: potSeries(snapshot.values, bucket, 31, at),
        };
      });

      const summary: PortfolioSummary = {
        timeframe,
        total,
        change,
        changeUnavailable,
        verdict: verdictFor(change, timeframe, changeUnavailable),
        buckets,
        // Only pots with a source have prices to be fresh or stale; including the
        // others would make "everything else updated just now" mean nothing.
        freshness: BUCKETS.filter((bucket) => snapshot.pots[bucket].status !== "not_connected").map(
          (bucket): BucketFreshness => ({
            bucket,
            freshness: freshnessFor(snapshot.pots[bucket], snapshot.schedules, at),
          }),
        ),
        activityComingSoon: true,
      };
      return summary;
    },

    async bucket(user, bucket, timeframe) {
      await refreshFirst(user);
      const snapshot = await load(user);
      const at = now();
      const pot = snapshot.pots[bucket];
      const value = pot.investedPence + pot.cashPence;
      const potChange =
        pot.status === "not_connected" ? null : changeFor(pot, timeframe, snapshot.values, at);
      const series = potSeries(snapshot.values, bucket, Number.POSITIVE_INFINITY, at);

      const holdingRows: Holding[] = [];
      const monthCloses = await asUser(options.db, user.authUserId, (tx) =>
        closesSince(
          tx,
          pot.held.map((held) => held.instrumentId),
          new Date(at.getTime() - 31 * 86_400_000),
        ),
      );
      for (const held of pot.held) {
        const heldValue =
          held.unitPence === undefined ? 0 : Math.round(held.quantity * held.unitPence);
        const previous = held.previousValuePence ?? heldValue;
        const perUnit =
          held.unitPence && held.price ? held.unitPence / Number(held.price.price) : undefined;
        holdingRows.push({
          id: held.instrumentId,
          name: held.name,
          subtitle: subtitleFor(held),
          bucket,
          value: heldValue,
          today: toChange(heldValue - previous, previous),
          ...sinceBought(heldValue, held.totalCostPence),
          shareOfBucket: value === 0 ? 0 : round2((heldValue / value) * 100),
          series:
            perUnit === undefined
              ? []
              : (monthCloses.get(held.instrumentId) ?? []).map((close) => ({
                  at: `${close.day}T16:30:00.000Z`,
                  value: Math.round(held.quantity * close.close * perUnit),
                })),
        });
      }
      if (pot.cashPence > 0) {
        holdingRows.push({
          id: `cash:${bucket}`,
          name: "Cash",
          subtitle: "Not invested yet",
          bucket,
          value: pot.cashPence,
          today: flat(),
          sinceBought: flat(),
          shareOfBucket: value === 0 ? 0 : round2((pot.cashPence / value) * 100),
          series: [],
          linkable: false,
        });
      }

      const detail: BucketDetail = {
        bucket,
        status: pot.status,
        value,
        change: potChange ? toChange(potChange.amount, potChange.base) : flat(),
        changeUnavailable: pot.status !== "not_connected" && potChange === null,
        blurb: COPY[bucket].blurb,
        plain: COPY[bucket].plain,
        chart: {
          from: series[0] ? monthYear(series[0].at) : "",
          series,
          caption: chartCaption(series),
        },
        moneyIn: { months: [], caption: "", comingSoon: true },
        holdings: holdingRows,
        freshness: freshnessFor(pot, snapshot.schedules, at),
      };
      return detail;
    },

    async instrument(user, id, range) {
      await refreshFirst(user);
      const snapshot = await load(user);
      const at = now();
      const found = BUCKETS.flatMap((bucket) =>
        snapshot.pots[bucket].held.map((held) => ({ bucket, held })),
      ).find((entry) => entry.held.instrumentId === id);
      if (!found) return null;
      const { bucket, held } = found;

      const value = held.unitPence === undefined ? 0 : Math.round(held.quantity * held.unitPence);
      const previous = held.previousValuePence ?? value;

      const detail: InstrumentDetail = {
        id,
        name: held.name,
        ticker: held.shortName,
        bucket,
        quantity: formatQuantity(held.quantity, held.type, held.shortName),
        price: held.unitPence === undefined ? 0 : Math.round(held.unitPence),
        value,
        today: toChange(value - previous, previous),
        ...sinceBought(value, held.totalCostPence),
        note: "",
        range,
        series: await instrumentSeries(options, user, held, range, at),
        freshness: freshnessFor({ ...snapshot.pots[bucket], held: [held] }, snapshot.schedules, at),
      };
      return detail;
    },

    async rules(user) {
      const snapshot = await load(user);
      const live = BUCKETS.filter((bucket) => snapshot.pots[bucket].status !== "not_connected");
      const total = live.reduce(
        (sum, bucket) =>
          sum + snapshot.pots[bucket].investedPence + snapshot.pots[bucket].cashPence,
        0,
      );

      const rules: BucketRule[] = BUCKETS.map((bucket) => {
        const pot = snapshot.pots[bucket];
        const available = pot.status !== "not_connected";
        const actual =
          !available || total === 0
            ? 0
            : round2(((pot.investedPence + pot.cashPence) / total) * 100);
        return {
          bucket,
          kind: bucket === "Degen" ? "cap" : "target",
          targetPercent: TARGETS[bucket],
          actualPercent: actual,
          available,
          plain: available
            ? `${displayNameFor(bucket)} is ${formatPercentPlain(actual)} of your money, against the ${TARGETS[bucket]}% you set.`
            : bucket === "Degen"
              ? "Connect your Kraken account in Setup to see where Side Bet sits against its cap."
              : `Connect your Trading 212 ${bucket === "Base" ? "ISA" : "Invest"} account in Setup to see where it sits.`,
        };
      });

      return { rules, monthlySplit: { total: 0, perBucket: [], comingSoon: true } };
    },

    async activity() {
      return [];
    },
  };
}

// ─── Loading ──────────────────────────────────────────────────────────────────

async function loadAsUser(tx: UserTx, at: Date): Promise<Snapshot> {
  const credentials = await tx
    .select({
      id: providerCredentials.id,
      accountKind: providerCredentials.accountKind,
      status: providerCredentials.status,
      lastPolledAt: providerCredentials.lastPolledAt,
      backfillStatus: providerCredentials.backfillStatus,
    })
    .from(providerCredentials);
  const heldRows = await tx
    .select({
      credentialId: holdings.credentialId,
      instrumentId: holdings.instrumentId,
      quantity: holdings.quantity,
      stakedQuantity: holdings.stakedQuantity,
      totalCostPence: holdings.totalCostPence,
      name: instruments.name,
      shortName: instruments.shortName,
      type: instruments.type,
      currency: instruments.currency,
      workingScheduleId: instruments.workingScheduleId,
    })
    .from(holdings)
    .innerJoin(instruments, eq(instruments.id, holdings.instrumentId));
  const cashRows = await tx.select().from(cash);
  // Instruments whose first trade was today (London day), from order history.
  const firstTrades = await tx
    .select({ instrumentId: trades.instrumentId, first: min(trades.filledAt) })
    .from(trades)
    .groupBy(trades.instrumentId);
  const today = londonDay(at);
  const boughtToday = new Set(
    firstTrades
      .filter((row) => row.first && londonDay(new Date(row.first)) === today)
      .map((row) => row.instrumentId),
  );

  const fxQuotes = [
    ...new Set(heldRows.map((row) => fxQuoteFor(row.currency)).filter((q) => q !== null)),
  ];
  const priceKeys = [
    ...new Set([...heldRows.map((row) => row.instrumentId), ...fxQuotes.map(fxKey)]),
  ];
  const priceRows = priceKeys.length
    ? await tx.select().from(prices).where(inArray(prices.key, priceKeys))
    : [];
  const priceByKey = new Map(
    priceRows.filter((row) => row.source !== "").map((row) => [row.key, row]),
  );
  const fxNow = new Map<string, number>();
  const fxPrevious = new Map<string, number>();
  for (const quote of fxQuotes) {
    const row = priceByKey.get(fxKey(quote));
    if (row) {
      fxNow.set(quote, Number(row.price));
      fxPrevious.set(quote, Number(row.previousClose ?? row.price));
    }
  }

  const scheduleIds = [
    ...new Set(heldRows.map((row) => row.workingScheduleId).filter((id) => id !== null)),
  ];
  const scheduleRows = scheduleIds.length
    ? await tx
        .select()
        .from(marketSchedules)
        .where(inArray(marketSchedules.scheduleId, scheduleIds))
    : [];
  const values = await tx.select().from(dailyValues).orderBy(asc(dailyValues.day));

  const pots = Object.fromEntries(
    BUCKETS.map((bucket): [Bucket, Pot] => [
      bucket,
      {
        bucket,
        status: "not_connected",
        held: [],
        cashPence: 0,
        investedPence: 0,
        costPence: 0,
        costKnown: true,
        todayPence: 0,
        previousInvestedPence: 0,
        priced: true,
      },
    ]),
  ) as Record<Bucket, Pot>;

  for (const credential of credentials) {
    const pot = pots[bucketForAccountKind(credential.accountKind)];
    // A pot is syncing until its first poll and history rebuild have finished.
    const syncing =
      credential.lastPolledAt === null ||
      ["pending", "running"].includes(credential.backfillStatus);
    pot.status = syncing ? "syncing" : "live";

    const cashRow = cashRows.find((row) => row.credentialId === credential.id);
    pot.cashPence += cashRow
      ? cashRow.availablePence + cashRow.reservedPence + cashRow.inPiesPence
      : 0;

    for (const row of heldRows.filter((held) => held.credentialId === credential.id)) {
      const held: HeldInstrument = {
        instrumentId: row.instrumentId,
        name: row.name,
        shortName: row.shortName,
        type: row.type,
        currency: row.currency,
        workingScheduleId: row.workingScheduleId,
        quantity: Number(row.quantity),
        stakedQuantity: row.stakedQuantity === null ? null : Number(row.stakedQuantity),
        totalCostPence: row.totalCostPence,
        price: priceByKey.get(row.instrumentId),
      };
      try {
        if (held.price) {
          held.unitPence = Number(held.price.price) * poundsPerUnit(row.currency, fxNow) * 100;
          held.previousUnitPence =
            Number(held.price.previousClose ?? held.price.price) *
            poundsPerUnit(row.currency, fxPrevious) *
            100;
        }
      } catch {
        held.unitPence = undefined;
      }
      if (held.unitPence === undefined) {
        pot.priced = false;
      } else {
        const value = Math.round(held.quantity * held.unitPence);
        const previous =
          boughtToday.has(held.instrumentId) && held.totalCostPence !== null
            ? held.totalCostPence
            : Math.round(held.quantity * (held.previousUnitPence ?? held.unitPence));
        held.previousValuePence = previous;
        pot.investedPence += value;
        pot.previousInvestedPence += previous;
        pot.todayPence += value - previous;
      }
      if (held.totalCostPence === null) pot.costKnown = false;
      else pot.costPence += held.totalCostPence;
      pot.held.push(held);
    }
  }

  return {
    pots,
    schedules: new Map(scheduleRows.map((row) => [row.scheduleId, row.events as ScheduleEvent[]])),
    values: values.filter((row) => row.day <= londonDay(at)),
  };
}

async function closesSince(tx: UserTx, keys: string[], from: Date) {
  const result = new Map<string, { day: string; close: number }[]>();
  if (keys.length === 0) return result;
  const rows = await tx
    .select()
    .from(dailyCloses)
    .where(
      and(inArray(dailyCloses.key, keys), gte(dailyCloses.day, from.toISOString().slice(0, 10))),
    )
    .orderBy(asc(dailyCloses.day));
  for (const row of rows) {
    const list = result.get(row.key) ?? [];
    list.push({ day: row.day, close: Number(row.close) });
    result.set(row.key, list);
  }
  return result;
}

async function instrumentSeries(
  options: LiveReadOptions,
  user: ReadUser,
  held: HeldInstrument,
  range: PriceRange,
  at: Date,
): Promise<SeriesPoint[]> {
  if (held.unitPence === undefined || !held.price) return [];
  // Pence per unit of the listing's own currency, at today's FX: the line's shape is the price's.
  const perUnit = held.unitPence / Number(held.price.price);

  if (range === "day") {
    const [series] = await asUser(options.db, user.authUserId, (tx) =>
      tx.select().from(intradaySeries).where(eq(intradaySeries.key, held.instrumentId)),
    );
    const points = (series?.points ?? []) as { at: string; price: string }[];
    return points.map((point) => ({
      at: point.at,
      value: Math.round(Number(point.price) * perUnit),
    }));
  }

  const firstTrade = await asUser(options.db, user.authUserId, (tx) =>
    tx
      .select({ at: trades.filledAt })
      .from(trades)
      .where(eq(trades.instrumentId, held.instrumentId))
      .orderBy(asc(trades.filledAt))
      .limit(1),
  );
  const from =
    range === "month"
      ? new Date(at.getTime() - 31 * 86_400_000)
      : range === "year"
        ? new Date(at.getTime() - 366 * 86_400_000)
        : (firstTrade[0]?.at ?? new Date(at.getTime() - 366 * 86_400_000));

  // Fill any gap in the shared cache first (privileged, budgeted); a failure just draws what's there.
  const [row] = await options.db
    .select()
    .from(instruments)
    .where(eq(instruments.id, held.instrumentId));
  const instrument: PricedInstrument = row ?? {
    id: held.instrumentId,
    type: "",
    currency: held.currency,
    yahooSymbol: null,
    alphaVantageSymbol: null,
    coingeckoId: null,
    krakenPair: null,
    workingScheduleId: held.workingScheduleId,
  };
  await ensureDailyCloses(
    options.db,
    options.marketFor(instrument),
    held.instrumentId,
    targetFor(instrument),
    from,
    at,
  ).catch(() => undefined);

  const closes = await asUser(options.db, user.authUserId, (tx) =>
    closesSince(tx, [held.instrumentId], from),
  );
  return (closes.get(held.instrumentId) ?? []).map((close) => ({
    at: `${close.day}T16:30:00.000Z`,
    value: Math.round(close.close * perUnit),
  }));
}

// ─── Figures ──────────────────────────────────────────────────────────────────

/** "Since bought", or a flat change marked unavailable when what was paid isn't known. */
function sinceBought(value: number, costPence: number | null) {
  return costPence === null
    ? { sinceBought: flat(), sinceBoughtUnavailable: true }
    : { sinceBought: toChange(value - costPence, costPence) };
}

/** A pot's change for a timeframe, or null when there isn't the history to say. */
function changeFor(
  pot: Pot,
  timeframe: Timeframe,
  values: (typeof dailyValues.$inferSelect)[],
  at: Date,
): { amount: number; base: number } | null {
  if (!pot.priced) return null;
  if (timeframe === "day") return { amount: pot.todayPence, base: pot.previousInvestedPence };
  if (timeframe === "all") {
    if (!pot.costKnown) return null;
    return { amount: pot.investedPence - pot.costPence, base: pot.costPence };
  }

  // This month: against the pot's invested value at the close a month ago.
  const monthAgo = new Date(at);
  monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
  const cutoff = londonDay(monthAgo);
  const past = values.filter((row) => row.bucket === pot.bucket && row.day <= cutoff).at(-1);
  if (!past) return null;
  return { amount: pot.investedPence - past.valuePence, base: past.valuePence };
}

function potSeries(
  values: (typeof dailyValues.$inferSelect)[],
  bucket: Bucket,
  days: number,
  at: Date,
): SeriesPoint[] {
  // `days` may be Infinity for the whole history; only compute a start date when it's finite.
  const from = Number.isFinite(days) ? londonDay(new Date(at.getTime() - days * 86_400_000)) : "";
  return values
    .filter((row) => row.bucket === bucket && row.day >= from)
    .map((row) => ({ at: `${row.day}T21:00:00.000Z`, value: row.valuePence }));
}

function freshnessFor(pot: Pot, schedules: Map<number, ScheduleEvent[]>, at: Date): PriceFreshness {
  const closedNow = (held: HeldInstrument) => {
    const schedule =
      held.workingScheduleId === null ? undefined : schedules.get(held.workingScheduleId);
    return schedule !== undefined && scheduleCovers(schedule, at) && !isMarketOpen(schedule, at);
  };
  const priced = pot.held.filter((held) => held.price !== undefined);
  const sources = [...new Set(priced.map((held) => held.price!.source))];
  const failed =
    pot.held.some((held) => !held.price) ||
    priced.some(
      (held) =>
        held.price!.lastFailedAt !== null && held.price!.lastFailedAt >= held.price!.fetchedAt,
    );
  // A closing price for a market that's shut isn't stale — it's the price. Only
  // listings still trading (or with no known schedule) count towards the age.
  // Crypto has no schedule and never closes, so it always counts.
  const trading = priced.filter((held) => !closedNow(held));
  const asOf = trading.length
    ? new Date(Math.min(...trading.map((held) => held.price!.asOf.getTime())))
    : at;
  return {
    source: sources.length
      ? sources.join(" · ")
      : pot.bucket === "Degen"
        ? "CoinGecko"
        : "Yahoo Finance",
    asOf: asOf.toISOString(),
    failed: pot.held.length > 0 && failed,
    marketsClosed: pot.held.length > 0 && pot.held.every(closedNow),
  };
}

function combine(changes: { amount: number; base: number }[]): Change {
  const amount = changes.reduce((sum, change) => sum + change.amount, 0);
  const base = changes.reduce((sum, change) => sum + change.base, 0);
  return toChange(amount, base);
}

function toChange(amount: number, base: number): Change {
  const rounded = Math.round(amount);
  return {
    amount: rounded,
    percent: base === 0 ? 0 : round2((rounded / base) * 100),
    direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
  };
}

function flat(): Change {
  return { amount: 0, percent: 0, direction: "flat" };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const WHEN: Record<Timeframe, string> = {
  day: "today",
  month: "this month",
  all: "since you started",
};

function verdictFor(change: Change, timeframe: Timeframe, unavailable: boolean): string {
  if (unavailable) return "Pip is still gathering your history.";
  const pounds = `£${(Math.abs(change.amount) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const moved =
    change.direction === "up"
      ? `Up ${pounds} ${WHEN[timeframe]}.`
      : change.direction === "down"
        ? `Down ${pounds} ${WHEN[timeframe]}.`
        : `Level ${WHEN[timeframe]}.`;
  return `${moved} Nothing needs you.`;
}

function chartCaption(series: SeriesPoint[]): string {
  if (series.length < 2) return "";
  const first = series[0]!;
  const last = series.at(-1)!;
  const moved = last.value - first.value;
  const pounds = `£${(Math.abs(moved) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const since = dayMonth(first.at);
  if (moved === 0) return `Your investments here are level since ${since}, not counting cash.`;
  return `Your investments here are ${moved > 0 ? "up" : "down"} ${pounds} since ${since}, not counting cash.`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayMonth(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

function monthYear(iso: string): string {
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatQuantity(quantity: number, type: string, shortName: string): string {
  if (type === "CRYPTO") {
    const shown = Number(quantity.toPrecision(6)).toLocaleString("en-GB", {
      maximumFractionDigits: 8,
    });
    return `${shown} ${shortName}`;
  }
  const unit = type === "ETF" ? "units" : "shares";
  const shown = Number(quantity.toFixed(4)).toLocaleString("en-GB", { maximumFractionDigits: 4 });
  return `${shown} ${quantity === 1 ? unit.replace(/s$/, "") : unit}`;
}

/** The sub-line under a holding: its ticker, what's staked, or that it can't be priced yet. */
function subtitleFor(held: HeldInstrument): string {
  if (held.unitPence === undefined) return "No price yet";
  if (held.type === "CRYPTO" && held.stakedQuantity) {
    const staked = Number(held.stakedQuantity.toPrecision(6)).toLocaleString("en-GB", {
      maximumFractionDigits: 8,
    });
    return `${held.shortName} · incl. ${staked} staked`;
  }
  return held.shortName;
}

function formatPercentPlain(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

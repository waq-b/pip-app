import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { dailyCloses, instruments, intradaySeries, marketSchedules, prices } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { isMarketOpen, scheduleCovers, type ScheduleEvent } from "./hours.js";
import type { withFallback } from "./sources/fallback.js";
import type { PriceTarget } from "./sources/types.js";

/**
 * The shared price cache. One refresh per instrument or FX pair for everyone —
 * never per user — written on the privileged connection. Read routes and the
 * scheduled job both call `refreshDue`; whichever gets there first does the
 * work and the other finds nothing due.
 */

type Market = ReturnType<typeof withFallback>;

/** An instrument as the cache needs to see it. */
export interface PricedInstrument {
  id: string;
  currency: string;
  yahooSymbol: string | null;
  alphaVantageSymbol: string | null;
  workingScheduleId: number | null;
}

export const FX_PAIRS = ["USD", "EUR"] as const;
export type FxQuote = (typeof FX_PAIRS)[number];

export const fxKey = (quote: FxQuote) => `FX:GBP${quote}`;

/** How long a price is good for. */
export const TTL = {
  marketOpenMs: 15 * 60_000,
  unknownScheduleMs: 60 * 60_000,
  fxMs: 30 * 60_000,
  /** After a failure, leave the source alone this long. */
  failureBackoffMs: 5 * 60_000,
};

interface CachedPrice {
  fetchedAt: Date;
  asOf: Date;
  lastFailedAt: Date | null;
}

/**
 * Due when there's no price, or it's older than the market's pace allows —
 * but never straight after a failure. A closed market needs one refresh after
 * it closes, then nothing until it opens again.
 */
export function isDue(
  cached: CachedPrice | undefined,
  schedule: ScheduleEvent[] | undefined,
  now: Date,
  kind: "instrument" | "fx",
): boolean {
  if (
    cached?.lastFailedAt &&
    now.getTime() - cached.lastFailedAt.getTime() < TTL.failureBackoffMs
  ) {
    return false;
  }
  if (!cached) return true;
  const age = now.getTime() - cached.fetchedAt.getTime();
  if (kind === "fx") return age >= TTL.fxMs;
  if (!schedule || !scheduleCovers(schedule, now)) return age >= TTL.unknownScheduleMs;
  if (isMarketOpen(schedule, now)) return age >= TTL.marketOpenMs;
  const lastClose = schedule
    .map((event) => Date.parse(event.date))
    .filter((time) => time <= now.getTime())
    .sort((a, b) => b - a)[0];
  return lastClose !== undefined && cached.fetchedAt.getTime() < lastClose;
}

export function targetFor(instrument: PricedInstrument): PriceTarget {
  return {
    kind: "instrument",
    symbol: instrument.yahooSymbol ?? instrument.alphaVantageSymbol ?? instrument.id,
    currency: instrument.currency,
  };
}

/** Per source, which symbol to ask for — or null when that source can't price it. */
export function symbolsFor(instrument: PricedInstrument) {
  return {
    yahoo: (target: PriceTarget) =>
      target.kind === "fx"
        ? target
        : instrument.yahooSymbol
          ? { ...target, symbol: instrument.yahooSymbol }
          : null,
    alphaVantage: (target: PriceTarget) =>
      target.kind === "fx"
        ? target
        : instrument.alphaVantageSymbol
          ? { ...target, symbol: instrument.alphaVantageSymbol }
          : null,
  };
}

export interface RefreshResult {
  refreshed: string[];
  failed: string[];
  skipped: string[];
}

/**
 * Refreshes whatever of `instrumentIds` (plus the FX pairs they need) is due.
 * Sequential on purpose: gentle on free sources, and a handful of instruments
 * takes a couple of seconds. Failures are recorded, never thrown — the last
 * good price stays and the staleness ladder tells the truth about its age.
 */
export async function refreshDue(
  db: Db,
  marketFor: (instrument: PricedInstrument | null) => Market,
  instrumentIds: string[],
  now: Date = new Date(),
): Promise<RefreshResult> {
  const result: RefreshResult = { refreshed: [], failed: [], skipped: [] };
  if (instrumentIds.length === 0) return result;

  const rows = await db.select().from(instruments).where(inArray(instruments.id, instrumentIds));
  const scheduleIds = [
    ...new Set(rows.map((row) => row.workingScheduleId).filter((id) => id !== null)),
  ];
  const schedules = new Map(
    (scheduleIds.length
      ? await db
          .select()
          .from(marketSchedules)
          .where(inArray(marketSchedules.scheduleId, scheduleIds))
      : []
    ).map((row) => [row.scheduleId, row.events as ScheduleEvent[]]),
  );
  const fxNeeded = new Set<FxQuote>();
  for (const row of rows) {
    const quote = fxQuoteFor(row.currency);
    if (quote) fxNeeded.add(quote);
  }

  const keys = [...rows.map((row) => row.id), ...[...fxNeeded].map(fxKey)];
  const cached = new Map(
    (await db.select().from(prices).where(inArray(prices.key, keys))).map((row) => [row.key, row]),
  );

  for (const quote of fxNeeded) {
    const key = fxKey(quote);
    if (!isDue(cached.get(key), undefined, now, "fx")) {
      result.skipped.push(key);
      continue;
    }
    await refreshOne(db, marketFor(null), key, { kind: "fx", quote }, now, result);
  }

  for (const row of rows) {
    const schedule =
      row.workingScheduleId === null ? undefined : schedules.get(row.workingScheduleId);
    if (!isDue(cached.get(row.id), schedule, now, "instrument")) {
      result.skipped.push(row.id);
      continue;
    }
    await refreshOne(db, marketFor(row), row.id, targetFor(row), now, result);
  }
  return result;
}

async function refreshOne(
  db: Db,
  market: Market,
  key: string,
  target: PriceTarget,
  now: Date,
  result: RefreshResult,
) {
  try {
    const { value: quote, source } = await market.quote(target);
    const row = {
      key,
      price: String(quote.price),
      previousClose: quote.previousClose === null ? null : String(quote.previousClose),
      currency: quote.currency,
      source: source.label,
      asOf: quote.asOf,
      fetchedAt: now,
      lastFailedAt: null,
    };
    await db.insert(prices).values(row).onConflictDoUpdate({ target: prices.key, set: row });
    if (quote.intraday?.length) {
      const series = {
        key,
        points: quote.intraday.map((point) => ({
          at: point.at.toISOString(),
          price: String(point.price),
        })),
        currency: quote.currency,
        source: source.label,
        asOf: quote.asOf,
      };
      await db
        .insert(intradaySeries)
        .values(series)
        .onConflictDoUpdate({ target: intradaySeries.key, set: series });
    }
    result.refreshed.push(key);
  } catch {
    // Keep the last good price; remember the failure so the next attempt backs off.
    await db
      .insert(prices)
      .values({
        key,
        price: "0",
        currency: "",
        source: "",
        asOf: new Date(0),
        fetchedAt: new Date(0),
        lastFailedAt: now,
      })
      .onConflictDoUpdate({ target: prices.key, set: { lastFailedAt: now } });
    result.failed.push(key);
  }
}

/**
 * Makes sure daily closes for `key` reach back to `from` and up to the latest
 * trading day, fetching only what's missing. Used by history backfill and the
 * month/year/all charts.
 */
export async function ensureDailyCloses(
  db: Db,
  market: Market,
  key: string,
  target: PriceTarget,
  from: Date,
  now: Date = new Date(),
): Promise<{ fetched: number; source?: string }> {
  const [latest] = await db
    .select({ day: dailyCloses.day })
    .from(dailyCloses)
    .where(eq(dailyCloses.key, key))
    .orderBy(desc(dailyCloses.day))
    .limit(1);
  const [earliest] = await db
    .select({ day: dailyCloses.day })
    .from(dailyCloses)
    .where(eq(dailyCloses.key, key))
    .orderBy(dailyCloses.day)
    .limit(1);

  const fromDay = from.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60_000).toISOString().slice(0, 10);
  const coversStart = earliest !== undefined && earliest.day <= fromDay;
  const coversEnd = latest !== undefined && latest.day >= yesterday;
  if (coversStart && coversEnd) return { fetched: 0 };

  const fetchFrom = coversStart && latest ? new Date(`${latest.day}T00:00:00Z`) : from;
  const { value: closes, source } = await market.dailyCloses(target, fetchFrom);
  if (closes.length) {
    const currency = target.kind === "fx" ? target.quote : target.currency;
    await db
      .insert(dailyCloses)
      .values(
        closes.map((close) => ({
          key,
          day: close.day,
          close: String(close.close),
          currency,
          source: source.label,
        })),
      )
      .onConflictDoUpdate({
        target: [dailyCloses.key, dailyCloses.day],
        set: { close: sql`excluded.close`, source: sql`excluded.source` },
      });
  }
  return { fetched: closes.length, source: source.label };
}

/** GBP-priced and pence-priced listings need no FX. */
export function fxQuoteFor(currency: string): FxQuote | null {
  if (currency === "USD") return "USD";
  if (currency === "EUR") return "EUR";
  return null;
}

/** Latest cached price rows for these keys, for valuing holdings. */
export async function cachedPrices(db: Db, keys: string[]) {
  if (keys.length === 0) return new Map<string, typeof prices.$inferSelect>();
  const rows = await db
    .select()
    .from(prices)
    .where(and(inArray(prices.key, keys), sql`${prices.source} <> ''`));
  return new Map(rows.map((row) => [row.key, row]));
}

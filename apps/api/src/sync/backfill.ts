import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { credentialContext } from "../crypto/reseal.js";
import type { SecretBox } from "../crypto/secrets.js";
import {
  dailyCloses,
  dailyValues,
  holdings,
  instruments,
  providerCredentials,
  trades,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { ensureDailyCloses, fxKey, fxQuoteFor, type PricedInstrument } from "../market/refresh.js";
import type { withFallback } from "../market/sources/fallback.js";
import { tradeRows } from "../providers/t212/rows.js";
import { bucketForAccountKind, toPencePounds } from "../valuation/value.js";
import { londonDay, type Credential, type T212ClientFor } from "./poll.js";

/**
 * Rebuilding a pot's history from order history (Phase 2 decision 6): what was
 * held on each past day, valued with that day's market close and FX — never
 * the trading API's prices (hard line 8). Investments only; see
 * `snapshotDailyValues` for why cash isn't included.
 *
 * Refuses to guess. If the fills don't add up to what the account holds now
 * (a transfer in, a pie, a missing page), no history is written and the pot's
 * history simply starts today. Days before prices are available are skipped,
 * so history starts on the first day every holding can be priced.
 *
 * Safe to rerun: fills are keyed by id, and a backfilled day never overwrites
 * a real snapshot.
 */

type Market = ReturnType<typeof withFallback>;

export type BackfillOutcome =
  | { outcome: "done"; days: number; startsOn: string | null }
  | {
      outcome: "partial";
      reason: "holdings_mismatch" | "prices_missing";
      days: number;
      startsOn: string | null;
    }
  | { outcome: "failed" };

const MAX_YEARS = 5;
const QUANTITY_TOLERANCE = 1e-6;

export async function backfillHistory(
  db: Db,
  box: SecretBox,
  credential: Credential,
  clientFor: T212ClientFor,
  marketFor: (instrument: PricedInstrument | null) => Market,
  now: Date = new Date(),
): Promise<BackfillOutcome> {
  await setBackfill(db, credential.id, "running");
  try {
    const t212 = clientFor(
      box.open(credential.sealedKey, credentialContext(credential, "key")),
      box.open(credential.sealedSecret, credentialContext(credential, "secret")),
    );

    const fills = [];
    for await (const fill of t212.fills()) fills.push(fill);
    const rows = tradeRows(fills, { credentialId: credential.id, userId: credential.userId });
    if (rows.length) await db.insert(trades).values(rows).onConflictDoNothing();

    const allTrades = await db
      .select()
      .from(trades)
      .where(eq(trades.credentialId, credential.id))
      .orderBy(asc(trades.filledAt));
    const today = londonDay(now);
    if (allTrades.length === 0)
      return finish(db, credential.id, { outcome: "done", days: 0, startsOn: today });

    if (!(await matchesHoldings(db, credential.id, allTrades))) {
      return finish(db, credential.id, {
        outcome: "partial",
        reason: "holdings_mismatch",
        days: 0,
        startsOn: today,
      });
    }

    const earliest = new Date(
      Math.max(allTrades[0]!.filledAt.getTime(), now.getTime() - MAX_YEARS * 365 * 86_400_000),
    );
    const firstDay = londonDay(earliest);
    const instrumentIds = [...new Set(allTrades.map((trade) => trade.instrumentId))];
    const instrumentRows = await db
      .select()
      .from(instruments)
      .where(inArray(instruments.id, instrumentIds));

    // Fetch the closes the rebuild needs; a source failing just leaves gaps.
    const fxNeeded = new Set(
      instrumentRows.map((row) => fxQuoteFor(row.currency)).filter((q) => q !== null),
    );
    for (const quote of fxNeeded) {
      await ensureDailyCloses(
        db,
        marketFor(null),
        fxKey(quote),
        { kind: "fx", quote },
        earliest,
        now,
      ).catch(() => undefined);
    }
    for (const row of instrumentRows) {
      const target = {
        kind: "instrument" as const,
        symbol: row.yahooSymbol ?? row.id,
        currency: row.currency,
      };
      await ensureDailyCloses(db, marketFor(row), row.id, target, earliest, now).catch(
        () => undefined,
      );
    }

    const keys = [...instrumentIds, ...[...fxNeeded].map(fxKey)];
    const closes = await db
      .select()
      .from(dailyCloses)
      .where(and(inArray(dailyCloses.key, keys), lte(dailyCloses.day, today)))
      .orderBy(asc(dailyCloses.day));
    const closesByKey = new Map<string, { day: string; close: number }[]>();
    for (const close of closes) {
      const list = closesByKey.get(close.key) ?? [];
      list.push({ day: close.day, close: Number(close.close) });
      closesByKey.set(close.key, list);
    }
    const currencyOf = new Map(instrumentRows.map((row) => [row.id, row.currency]));

    const bucket = bucketForAccountKind(credential.accountKind);
    const written: { day: string; valuePence: number; costPence: number }[] = [];
    let skippedForPrices = false;
    let tradeIndex = 0;
    const held = new Map<string, { quantity: number; costPence: number }>();

    // Up to yesterday: today belongs to the live snapshot.
    for (const day of daysBetween(firstDay, today)) {
      if (day === today) break;
      while (tradeIndex < allTrades.length && londonDay(allTrades[tradeIndex]!.filledAt) <= day) {
        applyTrade(held, allTrades[tradeIndex]!);
        tradeIndex += 1;
      }
      const positions = [...held].filter(([, position]) => position.quantity > QUANTITY_TOLERANCE);
      if (positions.length === 0) continue;

      let value = 0;
      let cost = 0;
      let priced = true;
      for (const [instrumentId, position] of positions) {
        const currency = currencyOf.get(instrumentId) ?? "";
        const close = closeOn(closesByKey.get(instrumentId), day);
        const quote = fxQuoteFor(currency);
        const rate = quote ? closeOn(closesByKey.get(fxKey(quote)), day) : 1;
        if (close === undefined || rate === undefined) {
          priced = false;
          break;
        }
        value += toPencePounds(
          position.quantity,
          close,
          currency,
          new Map(quote ? [[quote, rate]] : []),
        );
        cost += position.costPence;
      }
      if (!priced) {
        skippedForPrices = true;
        continue;
      }
      written.push({ day, valuePence: value, costPence: Math.round(cost) });
    }

    if (written.length) {
      await db
        .insert(dailyValues)
        .values(
          written.map((row) => ({ userId: credential.userId, bucket, source: "backfill", ...row })),
        )
        .onConflictDoUpdate({
          target: [dailyValues.userId, dailyValues.bucket, dailyValues.day],
          set: { valuePence: sql`excluded.value_pence`, costPence: sql`excluded.cost_pence` },
          // A real snapshot always wins over a rebuilt day.
          setWhere: ne(dailyValues.source, "snapshot"),
        });
    }

    const startsOn = written[0]?.day ?? today;
    return finish(
      db,
      credential.id,
      skippedForPrices
        ? { outcome: "partial", reason: "prices_missing", days: written.length, startsOn }
        : { outcome: "done", days: written.length, startsOn },
    );
  } catch {
    await setBackfill(db, credential.id, "failed");
    return { outcome: "failed" };
  }
}

/**
 * Average-cost bookkeeping: a buy adds what it cost excluding fees and taxes —
 * the same basis as Trading 212's own `totalCost`, so rebuilt days and live
 * days agree on "since you bought" — and a sell removes cost in proportion.
 */
function applyTrade(
  held: Map<string, { quantity: number; costPence: number }>,
  trade: {
    instrumentId: string;
    side: string;
    quantity: string;
    netValuePence: number;
    feesPence: number;
  },
) {
  const position = held.get(trade.instrumentId) ?? { quantity: 0, costPence: 0 };
  const quantity = Number(trade.quantity);
  if (trade.side === "BUY") {
    position.quantity += quantity;
    position.costPence += Math.abs(trade.netValuePence) - trade.feesPence;
  } else {
    const share = position.quantity > 0 ? Math.min(quantity / position.quantity, 1) : 1;
    position.costPence -= position.costPence * share;
    position.quantity -= quantity;
  }
  held.set(trade.instrumentId, position);
}

/** Do the fills add up to what the account holds now? */
async function matchesHoldings(
  db: Db,
  credentialId: string,
  allTrades: {
    instrumentId: string;
    side: string;
    quantity: string;
    netValuePence: number;
    feesPence: number;
  }[],
): Promise<boolean> {
  const held = new Map<string, { quantity: number; costPence: number }>();
  for (const trade of allTrades) applyTrade(held, trade);
  const current = await db.select().from(holdings).where(eq(holdings.credentialId, credentialId));
  const ids = new Set([...held.keys(), ...current.map((row) => row.instrumentId)]);
  for (const id of ids) {
    const rebuilt = held.get(id)?.quantity ?? 0;
    const actual = Number(current.find((row) => row.instrumentId === id)?.quantity ?? 0);
    if (Math.abs(rebuilt - actual) > Math.max(QUANTITY_TOLERANCE, actual * QUANTITY_TOLERANCE))
      return false;
  }
  return true;
}

/** Latest close on or before `day` — markets don't close at weekends, prices carry. */
function closeOn(
  list: { day: string; close: number }[] | undefined,
  day: string,
): number | undefined {
  if (!list) return undefined;
  let found: number | undefined;
  for (const entry of list) {
    if (entry.day > day) break;
    found = entry.close;
  }
  return found;
}

function* daysBetween(first: string, last: string): Generator<string> {
  const cursor = new Date(`${first}T12:00:00Z`);
  const end = new Date(`${last}T12:00:00Z`);
  while (cursor <= end) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

async function setBackfill(
  db: Db,
  credentialId: string,
  status: string,
  historyStartsOn?: string | null,
) {
  await db
    .update(providerCredentials)
    .set({ backfillStatus: status, ...(historyStartsOn !== undefined ? { historyStartsOn } : {}) })
    .where(eq(providerCredentials.id, credentialId));
}

async function finish(
  db: Db,
  credentialId: string,
  outcome: BackfillOutcome,
): Promise<BackfillOutcome> {
  if (outcome.outcome === "failed") {
    await setBackfill(db, credentialId, "failed");
  } else {
    await setBackfill(db, credentialId, outcome.outcome, outcome.startsOn);
  }
  return outcome;
}

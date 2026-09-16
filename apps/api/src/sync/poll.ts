import { and, eq, inArray, lt, or, isNull, sql } from "drizzle-orm";
import { credentialContext } from "../crypto/reseal.js";
import type { SecretBox } from "../crypto/secrets.js";
import {
  cash,
  dailyValues,
  holdings,
  instruments,
  marketSchedules,
  prices,
  providerCredentials,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { fxKey, fxQuoteFor } from "../market/refresh.js";
import {
  T212AuthError,
  T212PermissionError,
  type T212AccountSummary,
  type T212Client,
  type T212Position,
} from "../providers/t212/client.js";
import { cashRow, holdingRows, instrumentRow, NotInPoundsError } from "../providers/t212/rows.js";
import { bucketForAccountKind, MissingPriceError, toPencePounds } from "../valuation/value.js";

/**
 * Polling one provider account: open its sealed key in memory, ask what it
 * holds, store the facts. Runs on the privileged connection (jobs have no
 * user). Safe to repeat: a poll replaces the account's holdings wholesale.
 */

export type Credential = typeof providerCredentials.$inferSelect;
export type T212ClientFor = (key: string, secret: string) => T212Client;

export type PollOutcome =
  | { outcome: "polled"; holdings: number; newInstruments: number }
  | { outcome: "invalid_key" }
  | { outcome: "missing_permission"; permission: string }
  | { outcome: "not_pounds"; currency: string }
  | { outcome: "unavailable" };

/** Metadata is heavy (17k instruments, 1 call per 50s) — refetch at most daily, or when something's unknown. */
const METADATA_MAX_AGE_MS = 24 * 60 * 60_000;

export async function pollCredential(
  db: Db,
  box: SecretBox,
  credential: Credential,
  clientFor: T212ClientFor,
  now: Date = new Date(),
  /** Already read while validating a key on connect — saves waiting out T212's 1-per-5s limit. */
  prefetched?: { summary: T212AccountSummary; positions: T212Position[] },
): Promise<PollOutcome> {
  const key = box.open(credential.sealedKey, credentialContext(credential, "key"));
  const secret = box.open(credential.sealedSecret, credentialContext(credential, "secret"));
  const t212 = clientFor(key, secret);

  try {
    const summary = prefetched?.summary ?? (await t212.accountSummary());
    const positions = prefetched?.positions ?? (await t212.positions());
    const context = { credentialId: credential.id, userId: credential.userId, polledAt: now };
    const holdingValues = holdingRows(positions, context);
    const cashValues = cashRow(summary, context);

    const tickers = holdingValues.map((row) => row.instrumentId);
    const newInstruments = await ensureInstruments(db, t212, tickers, now);

    await db.transaction(async (tx) => {
      await tx.delete(holdings).where(eq(holdings.credentialId, credential.id));
      if (holdingValues.length) await tx.insert(holdings).values(holdingValues);
      await tx
        .insert(cash)
        .values(cashValues)
        .onConflictDoUpdate({ target: cash.credentialId, set: cashValues });
      await tx
        .update(providerCredentials)
        .set({
          status: "live",
          lastVerifiedAt: now,
          lastPolledAt: now,
          accountCurrency: summary.currency,
        })
        .where(eq(providerCredentials.id, credential.id));
    });
    return { outcome: "polled", holdings: holdingValues.length, newInstruments };
  } catch (error) {
    if (error instanceof T212AuthError) {
      await setStatus(db, credential.id, "invalid");
      return { outcome: "invalid_key" };
    }
    if (error instanceof T212PermissionError) {
      await setStatus(db, credential.id, "error");
      return { outcome: "missing_permission", permission: error.permission };
    }
    if (error instanceof NotInPoundsError) {
      await setStatus(db, credential.id, "error");
      return { outcome: "not_pounds", currency: error.currency };
    }
    // Unavailable, rate-limited or a changed response: keep what we had and try next time.
    return { outcome: "unavailable" };
  }
}

async function setStatus(db: Db, credentialId: string, status: "invalid" | "error") {
  await db
    .update(providerCredentials)
    .set({ status })
    .where(eq(providerCredentials.id, credentialId));
}

/** Makes sure every held ticker is a known instrument, with its market schedule. Returns how many were new. */
async function ensureInstruments(
  db: Db,
  t212: T212Client,
  tickers: string[],
  now: Date,
): Promise<number> {
  if (tickers.length === 0) return 0;
  const known = await db
    .select({ id: instruments.id, workingScheduleId: instruments.workingScheduleId })
    .from(instruments)
    .where(inArray(instruments.id, tickers));
  const missing = tickers.filter((ticker) => !known.some((row) => row.id === ticker));

  const scheduleIds = known
    .map((row) => row.workingScheduleId)
    .filter((id): id is number => id !== null);
  const staleSchedules = scheduleIds.length
    ? await db
        .select({ id: marketSchedules.scheduleId })
        .from(marketSchedules)
        .where(
          and(
            inArray(marketSchedules.scheduleId, scheduleIds),
            lt(marketSchedules.fetchedAt, new Date(now.getTime() - METADATA_MAX_AGE_MS)),
          ),
        )
    : [];
  const presentSchedules = scheduleIds.length
    ? await db
        .select({ id: marketSchedules.scheduleId })
        .from(marketSchedules)
        .where(inArray(marketSchedules.scheduleId, scheduleIds))
    : [];
  const schedulesMissing = scheduleIds.some((id) => !presentSchedules.some((row) => row.id === id));

  if (missing.length === 0 && staleSchedules.length === 0 && !schedulesMissing) return 0;

  let wantedSchedules = new Set(scheduleIds);
  if (missing.length) {
    const all = await t212.instruments();
    const found = all
      .filter((instrument) => missing.includes(instrument.ticker))
      .map(instrumentRow);
    if (found.length) {
      await db
        .insert(instruments)
        .values(found)
        .onConflictDoUpdate({
          target: instruments.id,
          set: {
            isin: sql`excluded.isin`,
            name: sql`excluded.name`,
            shortName: sql`excluded.short_name`,
            currency: sql`excluded.currency`,
            type: sql`excluded.type`,
            workingScheduleId: sql`excluded.working_schedule_id`,
            updatedAt: now,
          },
        });
    }
    wantedSchedules = new Set([...wantedSchedules, ...found.map((row) => row.workingScheduleId)]);
  }

  const exchanges = await t212.exchanges();
  const schedules = exchanges.flatMap((exchange) =>
    exchange.workingSchedules
      .filter((schedule) => wantedSchedules.has(schedule.id))
      .map((schedule) => ({
        scheduleId: schedule.id,
        exchangeName: exchange.name,
        events: schedule.timeEvents,
        fetchedAt: now,
      })),
  );
  if (schedules.length) {
    await db
      .insert(marketSchedules)
      .values(schedules)
      .onConflictDoUpdate({
        target: marketSchedules.scheduleId,
        set: {
          exchangeName: sql`excluded.exchange_name`,
          events: sql`excluded.events`,
          fetchedAt: now,
        },
      });
  }
  return missing.length;
}

/** Credentials that should be polled now: live or erroring, not polled within `minAgeMs`. */
export async function credentialsDue(db: Db, now: Date, minAgeMs: number) {
  return db
    .select()
    .from(providerCredentials)
    .where(
      and(
        inArray(providerCredentials.status, ["live", "error"]),
        or(
          isNull(providerCredentials.lastPolledAt),
          lt(providerCredentials.lastPolledAt, new Date(now.getTime() - minAgeMs)),
        ),
      ),
    );
}

/** London calendar day, which is the day Pip's users live in. */
export function londonDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Writes each of a user's pots' value for `day` from their latest holdings,
 * cash and cached prices. Cash counts at face value in both value and cost, so
 * value − cost is what the investments made. A pot with a holding that has no
 * price isn't snapshotted rather than snapshotted wrong.
 */
export async function snapshotDailyValues(db: Db, userId: string, day: string) {
  const credentials = await db
    .select()
    .from(providerCredentials)
    .where(and(eq(providerCredentials.userId, userId), eq(providerCredentials.status, "live")));
  const written: string[] = [];
  const skipped: string[] = [];

  for (const credential of credentials) {
    const bucket = bucketForAccountKind(credential.accountKind);
    const held = await db
      .select({
        instrumentId: holdings.instrumentId,
        quantity: holdings.quantity,
        totalCostPence: holdings.totalCostPence,
        currency: instruments.currency,
      })
      .from(holdings)
      .innerJoin(instruments, eq(instruments.id, holdings.instrumentId))
      .where(eq(holdings.credentialId, credential.id));
    const [cashRowValue] = await db.select().from(cash).where(eq(cash.credentialId, credential.id));

    const fxNeeded = [
      ...new Set(held.map((row) => fxQuoteFor(row.currency)).filter((q) => q !== null)),
    ];
    const keys = [...held.map((row) => row.instrumentId), ...fxNeeded.map(fxKey)];
    const priceRows = keys.length
      ? await db
          .select()
          .from(prices)
          .where(and(inArray(prices.key, keys), sql`${prices.source} <> ''`))
      : [];
    const byKey = new Map(priceRows.map((row) => [row.key, row]));
    const fx = new Map(
      fxNeeded.flatMap((quote) => {
        const row = byKey.get(fxKey(quote));
        return row ? [[quote, Number(row.price)] as const] : [];
      }),
    );

    try {
      let value = cashRowValue
        ? cashRowValue.availablePence + cashRowValue.reservedPence + cashRowValue.inPiesPence
        : 0;
      let cost = value;
      for (const row of held) {
        const price = byKey.get(row.instrumentId);
        if (!price) throw new MissingPriceError(row.instrumentId);
        value += toPencePounds(Number(row.quantity), Number(price.price), row.currency, fx);
        cost += row.totalCostPence;
      }
      const snapshot = {
        userId,
        bucket,
        day,
        valuePence: value,
        costPence: cost,
        source: "snapshot",
      };
      await db
        .insert(dailyValues)
        .values(snapshot)
        .onConflictDoUpdate({
          target: [dailyValues.userId, dailyValues.bucket, dailyValues.day],
          set: snapshot,
        });
      written.push(bucket);
    } catch (error) {
      if (!(error instanceof MissingPriceError)) throw error;
      skipped.push(bucket);
    }
  }
  return { written, skipped };
}

import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { dailyCloses, dailyValues, holdings, instruments, krakenLedger } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import {
  ensureDailyCloses,
  fxKey,
  targetFor,
  type FxQuote,
  type PricedInstrument,
} from "../market/refresh.js";
import type { withFallback } from "../market/sources/fallback.js";
import { closeOn, daysBetween, finish, setBackfill, type BackfillOutcome } from "./backfill.js";
import {
  baseAsset,
  DUST,
  ensureCoins,
  FIAT,
  krakenInstrumentId,
  type CoinDirectory,
} from "./kraken.js";
import { londonDay, type Credential } from "./poll.js";

/**
 * Side Bet's history and cost, from the Kraken ledger (Phase 3 task 6).
 *
 * Every ledger entry carries the asset's balance after it, so what was held on
 * any past day is read, not reconstructed. Values use each day's market close
 * in pounds — never Kraken's own account figures (hard line 8).
 *
 * Cost is average cost, in pence, per coin:
 * - bought with pounds, dollars or euros: what was paid (converted at that day's rate), fees excluded;
 * - swapped for from another coin, deposited or transferred in: its pound value that day
 *   (Phase 3 decision 5) — unknown if there's no price for that day;
 * - staking and earn rewards: nothing;
 * - sold, swapped away or withdrawn: cost leaves in proportion to the amount;
 * - moving between spot and staking: no change — it's the same coin.
 */

type Market = ReturnType<typeof withFallback>;
type Closes = Map<string, { day: string; close: number }[]>;

export interface LedgerRow {
  entryId: string;
  refid: string;
  at: Date;
  type: string;
  subtype: string;
  asset: string;
  amount: number;
  fee: number;
  balance: number;
}

export interface CoinPosition {
  quantity: number;
  /** Pence of pounds, or null when some of it can't be known. */
  costPence: number | null;
}

const utcDay = (at: Date) => at.toISOString().slice(0, 10);
const MAX_YEARS = 5;
/** CoinGecko's free history, less a day of margin. */
const RECENT_DAYS = 364;

/** Replays ledger groups (entries sharing a `refid`) in order, tracking each coin's quantity and cost. */
export function createLedgerBook(altnames: Map<string, string>, closes: Closes) {
  const balances = new Map<string, number>();
  const costs = new Map<string, number | null>();
  /** A coin never seen has cost 0; `null` (unknown) must survive, so no `??`. */
  const costOf = (base: string): number | null => (costs.has(base) ? costs.get(base)! : 0);

  function quantities(): Map<string, number> {
    const totals = new Map<string, number>();
    for (const [asset, balance] of balances) {
      const { base } = baseAsset(asset, altnames);
      if (FIAT.has(base)) continue;
      totals.set(base, (totals.get(base) ?? 0) + balance);
    }
    return totals;
  }

  function rate(currency: string, day: string): number | undefined {
    if (currency === "GBP") return 1;
    return closeOn(closes.get(fxKey(currency as FxQuote)), day);
  }

  function valueAt(base: string, quantity: number, day: string): number | null {
    const close = closeOn(closes.get(krakenInstrumentId(base)), day);
    return close === undefined ? null : quantity * close * 100;
  }

  return {
    apply(group: LedgerRow[]) {
      const day = utcDay(group[0]!.at);
      const before = quantities();
      for (const entry of group) balances.set(entry.asset, entry.balance);

      const internal = group.every(
        (entry) =>
          entry.type === "transfer" || (entry.type === "earn" && entry.subtype !== "reward"),
      );
      if (internal) return;
      const reward = group.every(
        (entry) =>
          entry.type === "staking" || (entry.type === "earn" && entry.subtype === "reward"),
      );

      const coinNet = new Map<string, number>();
      let fiatPence = 0;
      for (const entry of group) {
        const { base } = baseAsset(entry.asset, altnames);
        if (FIAT.has(base)) {
          // Fees excluded from cost, as with Trading 212's own basis.
          const perPound = rate(base, day);
          fiatPence += perPound === undefined ? Number.NaN : (entry.amount / perPound) * 100;
        } else {
          // What actually arrived or left, after any fee taken in the coin.
          coinNet.set(base, (coinNet.get(base) ?? 0) + entry.amount - entry.fee);
        }
      }

      let removed = 0;
      let removedUnknown = false;
      const negatives = [...coinNet].filter(([, net]) => net < -DUST);
      for (const [base, net] of negatives) {
        const held = before.get(base) ?? 0;
        const cost = costOf(base);
        const share = held > DUST ? Math.min(-net / held, 1) : 1;
        if (cost === null) removedUnknown = true;
        else {
          removed += cost * share;
          costs.set(base, cost - cost * share);
        }
        if (held + net <= DUST) costs.set(base, 0);
      }

      const positives = [...coinNet].filter(([, net]) => net > DUST);
      const totalIn = positives.reduce((sum, [, net]) => sum + net, 0);
      for (const [base, net] of positives) {
        // Starting from nothing, whatever was unknown before no longer matters.
        let cost: number | null = (before.get(base) ?? 0) <= DUST ? 0 : costOf(base);
        let added: number | null;
        if (reward) added = 0;
        else if (fiatPence < 0 || Number.isNaN(fiatPence)) {
          added = Number.isNaN(fiatPence) ? null : (-fiatPence * net) / totalIn;
        } else if (negatives.length) {
          added = valueAt(base, net, day) ?? (removedUnknown ? null : (removed * net) / totalIn);
        } else {
          added = valueAt(base, net, day);
        }
        cost = cost === null || added === null ? null : cost + added;
        costs.set(base, cost);
      }
    },

    positions(): Map<string, CoinPosition> {
      const result = new Map<string, CoinPosition>();
      for (const [base, quantity] of quantities()) {
        if (quantity <= DUST) continue;
        const cost = costOf(base);
        result.set(base, { quantity, costPence: cost === null ? null : Math.round(cost) });
      }
      return result;
    },
  };
}

/** Ledger entries grouped by `refid`, in the order they happened. */
export function groupByRefid(entries: LedgerRow[]): LedgerRow[][] {
  const groups = new Map<string, LedgerRow[]>();
  const sorted = [...entries].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.entryId.localeCompare(b.entryId),
  );
  for (const entry of sorted) {
    const group = groups.get(entry.refid) ?? [];
    group.push(entry);
    groups.set(entry.refid, group);
  }
  return [...groups.values()].sort((a, b) => a[0]!.at.getTime() - b[0]!.at.getTime());
}

async function loadLedger(db: Db, credentialId: string): Promise<LedgerRow[]> {
  const rows = await db
    .select()
    .from(krakenLedger)
    .where(eq(krakenLedger.credentialId, credentialId))
    .orderBy(asc(krakenLedger.at), asc(krakenLedger.entryId));
  return rows.map((row) => ({
    entryId: row.entryId,
    refid: row.refid,
    at: row.at,
    type: row.type,
    subtype: row.subtype,
    asset: row.asset,
    amount: Number(row.amount),
    fee: Number(row.fee),
    balance: Number(row.balance),
  }));
}

async function loadCloses(db: Db, keys: string[], upTo: string): Promise<Closes> {
  const closes: Closes = new Map();
  if (keys.length === 0) return closes;
  const rows = await db
    .select()
    .from(dailyCloses)
    .where(and(inArray(dailyCloses.key, keys), lte(dailyCloses.day, upTo)))
    .orderBy(asc(dailyCloses.day));
  for (const row of rows) {
    const list = closes.get(row.key) ?? [];
    list.push({ day: row.day, close: Number(row.close) });
    closes.set(row.key, list);
  }
  return closes;
}

function keysFor(entries: LedgerRow[], altnames: Map<string, string>) {
  const coins = new Set<string>();
  const fx = new Set<FxQuote>();
  for (const entry of entries) {
    const { base } = baseAsset(entry.asset, altnames);
    if (base === "USD" || base === "EUR") fx.add(base);
    else if (!FIAT.has(base)) coins.add(base);
  }
  return { coins: [...coins], fx: [...fx] };
}

/**
 * Sets each current holding's cost from the stored ledger and whatever closes
 * are cached — no fetching, so every poll can afford it. Unknown stays null.
 */
export async function applyKrakenCosts(
  db: Db,
  credentialId: string,
  altnames: Map<string, string>,
  now: Date,
): Promise<void> {
  const entries = await loadLedger(db, credentialId);
  if (entries.length === 0) return;
  const { coins, fx } = keysFor(entries, altnames);
  const closes = await loadCloses(
    db,
    [...coins.map(krakenInstrumentId), ...fx.map(fxKey)],
    utcDay(now),
  );
  const book = createLedgerBook(altnames, closes);
  for (const group of groupByRefid(entries)) book.apply(group);
  for (const [base, position] of book.positions()) {
    await db
      .update(holdings)
      .set({ totalCostPence: position.costPence })
      .where(
        and(
          eq(holdings.credentialId, credentialId),
          eq(holdings.instrumentId, krakenInstrumentId(base)),
        ),
      );
  }
}

/**
 * Rebuilds Side Bet's daily values from the ledger, up to yesterday (today
 * belongs to the live snapshot). Fetches the closes it needs first — CoinGecko
 * for the last year, Kraken's public prices further back; if older prices can't
 * be had, history starts where they do. Refuses to guess: if the ledger doesn't
 * end at what the account holds now, nothing is written.
 */
export async function backfillKrakenHistory(
  db: Db,
  credential: Credential,
  directory: CoinDirectory,
  marketFor: (instrument: PricedInstrument | null) => Market,
  now: Date = new Date(),
): Promise<BackfillOutcome> {
  await setBackfill(db, credential.id, "running");
  try {
    const today = londonDay(now);
    const entries = await loadLedger(db, credential.id);
    if (entries.length === 0) {
      return finish(db, credential.id, { outcome: "done", days: 0, startsOn: today });
    }

    const altnames = await directory.altnames();
    const { coins, fx } = keysFor(entries, altnames);
    await ensureCoins(db, directory, coins, now);

    const earliest = new Date(
      Math.max(entries[0]!.at.getTime(), now.getTime() - MAX_YEARS * 365 * 86_400_000),
    );
    const recent = new Date(Math.max(earliest.getTime(), now.getTime() - RECENT_DAYS * 86_400_000));
    const fetch = async (key: string, market: Market, target: Parameters<Market["quote"]>[0]) => {
      try {
        await ensureDailyCloses(db, market, key, target, earliest, now);
      } catch {
        // Too far back for every source: take what the last year can give.
        await ensureDailyCloses(db, market, key, target, recent, now).catch(() => undefined);
      }
    };
    for (const quote of fx) await fetch(fxKey(quote), marketFor(null), { kind: "fx", quote });
    const coinRows = coins.length
      ? await db
          .select()
          .from(instruments)
          .where(inArray(instruments.id, coins.map(krakenInstrumentId)))
      : [];
    for (const row of coinRows) await fetch(row.id, marketFor(row), targetFor(row));

    const closes = await loadCloses(
      db,
      [...coins.map(krakenInstrumentId), ...fx.map(fxKey)],
      today,
    );
    const groups = groupByRefid(entries);

    // The ledger must end where the account is now.
    const final = createLedgerBook(altnames, closes);
    for (const group of groups) final.apply(group);
    const current = await db
      .select()
      .from(holdings)
      .where(eq(holdings.credentialId, credential.id));
    const rebuilt = final.positions();
    const ids = new Set([
      ...[...rebuilt.keys()].map(krakenInstrumentId),
      ...current.map((row) => row.instrumentId),
    ]);
    for (const id of ids) {
      const ours = rebuilt.get(id.slice("kraken:".length))?.quantity ?? 0;
      const theirs = Number(current.find((row) => row.instrumentId === id)?.quantity ?? 0);
      if (Math.abs(ours - theirs) > Math.max(1e-8, theirs * 1e-6)) {
        return finish(db, credential.id, {
          outcome: "partial",
          reason: "holdings_mismatch",
          days: 0,
          startsOn: today,
        });
      }
    }

    const book = createLedgerBook(altnames, closes);
    const written: { day: string; valuePence: number; costPence: number }[] = [];
    let skippedForPrices = false;
    let groupIndex = 0;
    for (const day of daysBetween(londonDay(earliest), today)) {
      if (day === today) break;
      while (groupIndex < groups.length && londonDay(groups[groupIndex]![0]!.at) <= day) {
        book.apply(groups[groupIndex]!);
        groupIndex += 1;
      }
      const positions = book.positions();
      if (positions.size === 0) continue;
      let value = 0;
      let cost = 0;
      let priced = true;
      for (const [base, position] of positions) {
        const close = closeOn(closes.get(krakenInstrumentId(base)), day);
        if (close === undefined) {
          priced = false;
          break;
        }
        const held = Math.round(position.quantity * close * 100);
        value += held;
        // Unknown cost counts as its value, so no gain or loss is invented.
        cost += position.costPence ?? held;
      }
      if (!priced) {
        skippedForPrices = true;
        continue;
      }
      written.push({ day, valuePence: value, costPence: cost });
    }

    if (written.length) {
      await db
        .insert(dailyValues)
        .values(
          written.map((row) => ({
            userId: credential.userId,
            bucket: "Degen",
            source: "backfill",
            ...row,
          })),
        )
        .onConflictDoUpdate({
          target: [dailyValues.userId, dailyValues.bucket, dailyValues.day],
          set: { valuePence: sql`excluded.value_pence`, costPence: sql`excluded.cost_pence` },
          setWhere: ne(dailyValues.source, "snapshot"),
        });
    }
    await applyKrakenCosts(db, credential.id, altnames, now);

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

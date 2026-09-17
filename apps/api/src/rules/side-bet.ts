import {
  LIMIT_WINDOW_MONTHS,
  SIDE_BET_LIMIT_SHARE,
  SIDE_BET_STARTER_LIMIT_PENCE,
  type Pence,
} from "@finance-app/shared";
import { and, eq, gte } from "drizzle-orm";
import { krakenLedger } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import type { SideBetInput } from "./engine.js";

/**
 * Side Bet's limit, and what it's judged against (phase-6.md decision 13).
 *
 * The limit is the FCA's 10% guide applied to the net assets the user told Pip
 * — or a flat starter limit until they have. Pip can't restrict anything and
 * doesn't pretend to: it says where the line is (hard line 1). It also only
 * counts Side Bet, not high-risk investments held anywhere else.
 *
 * What it's judged against is **money in, less taken out** over the last 12
 * months, not what Side Bet is worth: it's a measure of how much of your own
 * money you've put at risk, so taking profit out makes room again, and prices
 * moving can never push you over.
 */

/** Pounds in, pence out. Net assets of nothing still mean the starter limit. */
export function limitFor(netAssetsPence: Pence | null): { limitPence: Pence; starter: boolean } {
  if (netAssetsPence === null || netAssetsPence <= 0) {
    return { limitPence: SIDE_BET_STARTER_LIMIT_PENCE, starter: true };
  }
  return { limitPence: Math.round(netAssetsPence * SIDE_BET_LIMIT_SHARE), starter: false };
}

/** The start of the rolling window money in is counted over. */
export function windowStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - LIMIT_WINDOW_MONTHS);
  return start;
}

/**
 * Kraken's ledger writes fiat in and out as its own entries, so money in is
 * their sum: deposits are positive, withdrawals negative.
 *
 * Only pounds are counted. A deposit in another currency, or crypto sent in
 * from elsewhere, isn't counted yet — Waqar's account is in pounds, and
 * guessing at a rate would put a number Pip isn't sure of against a limit that
 * matters. Recorded in ARCHITECTURE as a known gap.
 */
const GBP_ASSETS = new Set(["ZGBP", "GBP"]);

export interface LedgerEntry {
  at: Date;
  type: string;
  asset: string;
  amount: number;
}

export function moneyInFrom(entries: LedgerEntry[], now: Date): Pence {
  const since = windowStart(now);
  let pence = 0;
  for (const entry of entries) {
    if (entry.at < since || entry.at > now) continue;
    if (!GBP_ASSETS.has(entry.asset)) continue;
    if (entry.type !== "deposit" && entry.type !== "withdrawal") continue;
    pence += Math.round(entry.amount * 100);
  }
  // Taking out more than went in over the window doesn't earn extra room.
  return Math.max(0, pence);
}

export interface SideBetLimitReader {
  /** Everything the engine needs to judge Side Bet, for one user. */
  read(user: { userId: string }, now: Date): Promise<SideBetInput>;
}

export function dbSideBetLimits(
  db: Db,
  netAssets: { pence(userId: string): Promise<Pence | null> },
): SideBetLimitReader {
  return {
    async read(user, now) {
      const [entries, netAssetsPence] = await Promise.all([
        db
          .select({
            at: krakenLedger.at,
            type: krakenLedger.type,
            asset: krakenLedger.asset,
            amount: krakenLedger.amount,
          })
          .from(krakenLedger)
          .where(and(eq(krakenLedger.userId, user.userId), gte(krakenLedger.at, windowStart(now)))),
        netAssets.pence(user.userId),
      ]);
      const { limitPence, starter } = limitFor(netAssetsPence);
      return {
        limitPence,
        moneyInPence: moneyInFrom(
          entries.map((entry) => ({ ...entry, amount: Number(entry.amount) })),
          now,
        ),
        starterLimit: starter,
      };
    },
  };
}

/** Stub mode and tests: a fixed answer, with the starter limit by default. */
export function fixedSideBetLimits(input: Partial<SideBetInput> = {}): SideBetLimitReader {
  const answer: SideBetInput = {
    limitPence: SIDE_BET_STARTER_LIMIT_PENCE,
    moneyInPence: 0,
    starterLimit: true,
    ...input,
  };
  return {
    async read() {
      return answer;
    },
  };
}

import { and, eq, inArray, sql } from "drizzle-orm";
import { credentialContext } from "../crypto/reseal.js";
import type { SecretBox } from "../crypto/secrets.js";
import {
  cash,
  holdings,
  instruments,
  krakenLedger,
  prices,
  providerCredentials,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { fxKey } from "../market/refresh.js";
import {
  KrakenAuthError,
  KrakenPermissionError,
  type KrakenBalance,
  type KrakenClient,
  type KrakenLedgerEntry,
} from "../providers/kraken/client.js";
import { checkKrakenPermissions, type PermissionCheck } from "../providers/kraken/permissions.js";
import { applyKrakenCosts } from "./kraken-history.js";
import type { Credential } from "./poll.js";

/**
 * Polling a Kraken account (Phase 3): check the key still can't move money,
 * read balances into holdings and cash, and store any new ledger entries.
 * Runs on the privileged connection. Safe to repeat: holdings are replaced
 * wholesale, and ledger entries are keyed by Kraken's id.
 */

export type KrakenClientFor = (key: string, secret: string) => KrakenClient;

/**
 * Where coin names and price symbols come from — public market data, not the
 * account (CoinGecko ids and names, Kraken's asset names and pounds pairs).
 * Only asked about assets Pip hasn't met before.
 */
export interface CoinDirectory {
  /** Kraken asset name → altname (`XXBT` → `XBT`). */
  altnames(): Promise<Map<string, string>>;
  /** Kraken altname → CoinGecko id (`XBT` → `bitcoin`). */
  coinIds(): Promise<Map<string, string>>;
  details(ids: string[]): Promise<Map<string, { name: string; symbol: string }>>;
  gbpPair(altname: string): Promise<string | null>;
}

export type KrakenPollOutcome =
  | { outcome: "polled"; holdings: number; newInstruments: number; newLedgerEntries: number }
  | { outcome: "invalid_key" }
  | { outcome: "missing_permission"; permission: string }
  | { outcome: "too_much_access"; check: PermissionCheck }
  | { outcome: "unavailable" };

/** Cash Pip can count in pounds. Other currencies are left out rather than guessed. */
export const FIAT = new Set(["GBP", "USD", "EUR"]);
/** Below this a balance is dust from rounding, not a holding. */
export const DUST = 1e-10;

export const krakenInstrumentId = (altname: string) => `kraken:${altname}`;

/**
 * `XXBT` → `XBT`; `DOT.S`, `DOT28.S` → `DOT`, staked; `GBP.HOLD` → `GBP`.
 * Suffixes are Kraken's read-only views of the base asset (staked, rewards,
 * bonded), so they count as the same coin .
 */
export function baseAsset(asset: string, altnames: Map<string, string>) {
  const [name, suffix] = asset.split(".", 2) as [string, string | undefined];
  let base = altnames.get(name) ?? name;
  const bonded = /^([A-Z]+?)\d+$/.exec(base);
  const known = new Set(altnames.values());
  if (suffix !== undefined && bonded && known.has(bonded[1]!)) base = bonded[1]!;
  return { base, staked: suffix !== undefined && suffix !== "HOLD", held: suffix === "HOLD" };
}

export async function pollKraken(
  db: Db,
  box: SecretBox,
  credential: Credential,
  clientFor: KrakenClientFor,
  directory: CoinDirectory,
  now: Date = new Date(),
): Promise<KrakenPollOutcome> {
  const key = box.open(credential.sealedKey, credentialContext(credential, "key"));
  const secret = box.open(credential.sealedSecret, credentialContext(credential, "secret"));
  const kraken = clientFor(key, secret);

  try {
    // A key's permissions can be edited at Kraken after it was connected.
    const check = checkKrakenPermissions((await kraken.keyInfo()).permissions);
    if (!check.ok) {
      await setStatus(db, credential.id, "error");
      return check.forbidden.length
        ? { outcome: "too_much_access", check }
        : { outcome: "missing_permission", permission: check.missing[0]! };
    }

    const balances = await kraken.balances();
    const known = new Set(
      (
        await db
          .select({ id: krakenLedger.entryId })
          .from(krakenLedger)
          .where(eq(krakenLedger.credentialId, credential.id))
      ).map((row) => row.id),
    );
    // Newest first: stop at the first entry already stored.
    const fresh: KrakenLedgerEntry[] = [];
    for await (const entry of kraken.ledger()) {
      if (known.has(entry.id)) break;
      fresh.push(entry);
    }

    const altnames = await directory.altnames();
    const { coins, fiat } = group(balances, altnames);
    const newInstruments = await ensureCoins(db, directory, [...coins.keys()], now);
    const cashRow = await cashInPounds(db, credential, fiat, now);
    const holdingRows = [...coins].map(([altname, amounts]) => ({
      credentialId: credential.id,
      userId: credential.userId,
      instrumentId: krakenInstrumentId(altname),
      quantity: String(amounts.total),
      stakedQuantity: amounts.staked > 0 ? String(amounts.staked) : null,
      averagePricePaid: null,
      // Set from the ledger just below, once the new entries are stored.
      totalCostPence: null,
      polledAt: now,
    }));

    await db.transaction(async (tx) => {
      await tx.delete(holdings).where(eq(holdings.credentialId, credential.id));
      if (holdingRows.length) await tx.insert(holdings).values(holdingRows);
      await tx
        .insert(cash)
        .values(cashRow)
        .onConflictDoUpdate({ target: cash.credentialId, set: cashRow });
      if (fresh.length) {
        await tx
          .insert(krakenLedger)
          .values(
            fresh.map((entry) => ({
              credentialId: credential.id,
              userId: credential.userId,
              entryId: entry.id,
              refid: entry.refid,
              at: entry.time,
              type: entry.type,
              subtype: entry.subtype,
              asset: entry.asset,
              amount: String(entry.amount),
              fee: String(entry.fee),
              balance: String(entry.balance),
            })),
          )
          .onConflictDoNothing();
      }
      await tx
        .update(providerCredentials)
        .set({ status: "live", lastVerifiedAt: now, lastPolledAt: now })
        .where(eq(providerCredentials.id, credential.id));
    });
    await applyKrakenCosts(db, credential.id, altnames, now);
    return {
      outcome: "polled",
      holdings: holdingRows.length,
      newInstruments,
      newLedgerEntries: fresh.length,
    };
  } catch (error) {
    if (error instanceof KrakenAuthError) {
      await setStatus(db, credential.id, "invalid");
      return { outcome: "invalid_key" };
    }
    if (error instanceof KrakenPermissionError) {
      await setStatus(db, credential.id, "error");
      return { outcome: "missing_permission", permission: error.permission ?? "Query Funds" };
    }
    // Unavailable, rate-limited or a changed response: keep what we had and try next time.
    return { outcome: "unavailable" };
  }
}

function group(balances: KrakenBalance[], altnames: Map<string, string>) {
  const coins = new Map<string, { total: number; staked: number }>();
  const fiat = new Map<string, { available: number; reserved: number }>();
  for (const { asset, balance, holdTrade } of balances) {
    if (Math.abs(balance) < DUST) continue;
    const { base, staked, held } = baseAsset(asset, altnames);
    if (FIAT.has(base)) {
      const amounts = fiat.get(base) ?? { available: 0, reserved: 0 };
      if (held) amounts.reserved += balance;
      else {
        amounts.available += balance - holdTrade;
        amounts.reserved += holdTrade;
      }
      fiat.set(base, amounts);
    } else if (/^[A-Z]{3}$/.test(base) && altnames.has(`${base}.HOLD`)) {
      // Another fiat currency (CAD, CHF…): Pip can't count it in pounds, so it's left out.
      continue;
    } else {
      const amounts = coins.get(base) ?? { total: 0, staked: 0 };
      amounts.total += balance;
      if (staked) amounts.staked += balance;
      coins.set(base, amounts);
    }
  }
  return { coins, fiat };
}

/** New coins become instruments, with names and price symbols from public market data. */
export async function ensureCoins(db: Db, directory: CoinDirectory, altnames: string[], now: Date) {
  if (altnames.length === 0) return 0;
  const ids = altnames.map(krakenInstrumentId);
  const existing = await db
    .select({ id: instruments.id })
    .from(instruments)
    .where(inArray(instruments.id, ids));
  const missing = altnames.filter(
    (alt) => !existing.some((row) => row.id === krakenInstrumentId(alt)),
  );
  if (missing.length === 0) return 0;

  const coinIds = await directory.coinIds();
  const details = await directory.details(
    missing.map((alt) => coinIds.get(alt)).filter((id): id is string => id !== undefined),
  );
  const rows = [];
  for (const alt of missing) {
    const coingeckoId = coinIds.get(alt) ?? null;
    const about = coingeckoId ? details.get(coingeckoId) : undefined;
    rows.push({
      id: krakenInstrumentId(alt),
      isin: "",
      name: about?.name ?? alt,
      shortName: about?.symbol ?? (alt === "XBT" ? "BTC" : alt),
      currency: "GBP",
      type: "CRYPTO",
      workingScheduleId: null,
      coingeckoId,
      krakenPair: await directory.gbpPair(alt),
      updatedAt: now,
    });
  }
  await db.insert(instruments).values(rows).onConflictDoNothing();
  return rows.length;
}

/** GBP as is; USD and EUR at the cached rate. Without a rate, that currency is left out. */
async function cashInPounds(
  db: Db,
  credential: Credential,
  fiat: Map<string, { available: number; reserved: number }>,
  now: Date,
) {
  const quotes = [...fiat.keys()].filter((currency) => currency !== "GBP");
  const rates = new Map<string, number>();
  if (quotes.length) {
    const rows = await db
      .select({ key: prices.key, price: prices.price })
      .from(prices)
      .where(
        and(
          inArray(
            prices.key,
            quotes.map((quote) => fxKey(quote as "USD" | "EUR")),
          ),
          sql`${prices.source} <> ''`,
        ),
      );
    for (const row of rows) rates.set(row.key.slice("FX:GBP".length), Number(row.price));
  }
  let available = 0;
  let reserved = 0;
  for (const [currency, amounts] of fiat) {
    const perPound = currency === "GBP" ? 1 : rates.get(currency);
    if (!perPound) continue;
    available += amounts.available / perPound;
    reserved += amounts.reserved / perPound;
  }
  return {
    credentialId: credential.id,
    userId: credential.userId,
    availablePence: Math.round(available * 100),
    reservedPence: Math.round(reserved * 100),
    inPiesPence: 0,
    polledAt: now,
  };
}

async function setStatus(db: Db, credentialId: string, status: "invalid" | "error") {
  await db
    .update(providerCredentials)
    .set({ status })
    .where(eq(providerCredentials.id, credentialId));
}

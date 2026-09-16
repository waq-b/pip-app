import { and, eq, inArray } from "drizzle-orm";
import type { SecretBox } from "../crypto/secrets.js";
import { holdings, providerCredentials } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { collectFacts } from "../facts/collect.js";
import type { FactsAdapter } from "../facts/types.js";
import { refreshDue, type PricedInstrument } from "../market/refresh.js";
import type { withFallback } from "../market/sources/fallback.js";
import { backfillHistory } from "../sync/backfill.js";
import { backfillKrakenHistory } from "../sync/kraken-history.js";
import { pollKraken, type CoinDirectory, type KrakenClientFor } from "../sync/kraken.js";
import {
  credentialsDue,
  londonDay,
  pollCredential,
  snapshotDailyValues,
  type T212ClientFor,
} from "../sync/poll.js";

/**
 * One scheduled refresh (Phase 2 task 11), fired by `pg_cron` through
 * `POST /jobs/refresh`. Every step is idempotent and skips what's already
 * fresh, so running it twice, or alongside a user's refresh-on-read, is
 * harmless. A step failing never stops the others.
 *
 * 1. Poll accounts not polled in the last 25 minutes.
 * 2. Rebuild history for one account still waiting for it.
 * 3. Refresh prices that are due, for everything anyone holds.
 * 4. Save today's pot values for everyone with a live account.
 * 5. Collect facts — news and results dates — for what's held (Phase 5), from
 *    whichever sources are due and within budget.
 */

type Market = ReturnType<typeof withFallback>;

export interface RefreshJobDeps {
  db: Db;
  box: SecretBox;
  clientFor: T212ClientFor;
  kraken?: { clientFor: KrakenClientFor; directory: CoinDirectory };
  marketFor: (instrument: PricedInstrument | null) => Market;
  /** Facts sources (Phase 5). Without them, no facts are collected. */
  facts?: FactsAdapter[];
  now?: () => Date;
}

export interface RefreshJobSummary {
  polled: number;
  backfilled: number;
  pricesRefreshed: number;
  pricesFailed: number;
  snapshots: number;
  /** Facts sources read, reports newly stored, results dates written. */
  facts: { read: number; stored: number; events: number };
  errors: string[];
}

const POLL_EVERY_MS = 25 * 60_000;

export function createRefreshJob(deps: RefreshJobDeps) {
  const now = deps.now ?? (() => new Date());
  let running: Promise<RefreshJobSummary> | null = null;

  async function runOnce(): Promise<RefreshJobSummary> {
    const at = now();
    const summary: RefreshJobSummary = {
      polled: 0,
      backfilled: 0,
      pricesRefreshed: 0,
      pricesFailed: 0,
      snapshots: 0,
      facts: { read: 0, stored: 0, events: 0 },
      errors: [],
    };
    const step = async (name: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch {
        summary.errors.push(name);
      }
    };

    await step("poll", async () => {
      for (const credential of await credentialsDue(deps.db, at, POLL_EVERY_MS)) {
        const outcome =
          credential.provider === "kraken"
            ? deps.kraken
              ? await pollKraken(
                  deps.db,
                  deps.box,
                  credential,
                  deps.kraken.clientFor,
                  deps.kraken.directory,
                  at,
                )
              : null
            : await pollCredential(deps.db, deps.box, credential, deps.clientFor, at);
        if (outcome?.outcome === "polled") summary.polled += 1;
      }
    });

    await step("backfill", async () => {
      const [waiting] = await deps.db
        .select()
        .from(providerCredentials)
        .where(
          and(
            eq(providerCredentials.status, "live"),
            eq(providerCredentials.backfillStatus, "pending"),
          ),
        )
        .limit(1);
      if (!waiting) return;
      if (waiting.provider === "kraken" && !deps.kraken) return;
      const outcome =
        waiting.provider === "kraken"
          ? await backfillKrakenHistory(
              deps.db,
              waiting,
              deps.kraken!.directory,
              deps.marketFor,
              at,
            )
          : await backfillHistory(deps.db, deps.box, waiting, deps.clientFor, deps.marketFor, at);
      if (outcome.outcome !== "failed") summary.backfilled += 1;
    });

    await step("prices", async () => {
      const held = await deps.db.selectDistinct({ id: holdings.instrumentId }).from(holdings);
      const result = await refreshDue(
        deps.db,
        deps.marketFor,
        held.map((row) => row.id),
        at,
      );
      summary.pricesRefreshed = result.refreshed.length;
      summary.pricesFailed = result.failed.length;
    });

    await step("snapshots", async () => {
      const owners = await deps.db
        .selectDistinct({ userId: providerCredentials.userId })
        .from(providerCredentials)
        .where(inArray(providerCredentials.status, ["live"]));
      const day = londonDay(at);
      for (const { userId } of owners) {
        const result = await snapshotDailyValues(deps.db, userId, day);
        summary.snapshots += result.written.length;
      }
    });

    await step("facts", async () => {
      if (!deps.facts?.length) return;
      const result = await collectFacts({ db: deps.db, adapters: deps.facts, now: at });
      summary.facts = { read: result.read, stored: result.stored, events: result.events };
    });

    return summary;
  }

  return {
    /** Runs the job, or joins the run already in progress rather than starting a second. */
    run(): Promise<RefreshJobSummary> {
      running ??= runOnce().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
